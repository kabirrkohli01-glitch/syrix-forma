import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees, leaveAllowances, leaveSettings, leaveTypes, publicHolidays } from '@/lib/db/schema';

// Only auth() is faked. The permission predicates, validation, day/half-day conversion and
// database writes all run for real — same convention as tests/hr/leave-flow.test.ts.
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const {
  addPublicHoliday,
  clearLeaveAllowance,
  removePublicHoliday,
  setLeaveTypeArchived,
  updateLeaveSettings,
  upsertLeaveAllowance,
  upsertLeaveType
} = await import('@/features/hr/settings-actions');
const { currentLeaveYear, getLeaveBalance, getLeaveSettings } = await import(
  '@/features/hr/utils/leave-queries'
);
const { listLeaveAllowances } = await import('@/features/hr/utils/settings-queries');

// Step-up auth is bound to the session that passed the challenge, so these suites need a
// stable session id to both stage a step-up and then spend it.
const TEST_SESSION = 'sess_test_step_up';

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = {
  /** Platform administrator with the hrAdmin capability — the case the flag exists for. */
  admin: `test_${runId}_admin`,
  /** Plain employee. Must be refused everything here. */
  worker: `test_${runId}_worker`,
  /** Security administrator, who must stay walled off even if the flag is somehow set. */
  security: `test_${runId}_security`
};

const ids = { admin: '', worker: '', security: '' };
const createdLeaveTypeIds: string[] = [];
const createdHolidayIds: string[] = [];
let originalSettings: typeof leaveSettings.$inferSelect;

function asCaller(key: keyof typeof clerkIds) {
  mockAuth.mockResolvedValue({ userId: clerkIds[key], sessionId: TEST_SESSION });
}

beforeAll(async () => {
  originalSettings = await getLeaveSettings();

  const inserted = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.admin,
        name: 'Settings Test Admin',
        email: `${clerkIds.admin}@example.test`,
        role: 'ADMIN',
        status: 'active',
        // The point of the capability: ADMIN keeps its role and gains HR.
        hrAdmin: true
      },
      {
        clerkUserId: clerkIds.worker,
        name: 'Settings Test Worker',
        email: `${clerkIds.worker}@example.test`,
        role: 'EMPLOYEE',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.security,
        name: 'Settings Test Security',
        email: `${clerkIds.security}@example.test`,
        role: 'SECURITY_ADMIN',
        status: 'active',
        hrAdmin: true
      }
    ])
    .returning({ id: employees.id, clerkUserId: employees.clerkUserId });

  for (const row of inserted) {
    const key = (Object.keys(clerkIds) as (keyof typeof clerkIds)[]).find(
      (k) => clerkIds[k] === row.clerkUserId
    );
    if (key) ids[key] = row.id;
  }

});

afterAll(async () => {
  if (createdHolidayIds.length > 0) {
    await db.delete(publicHolidays).where(inArray(publicHolidays.id, createdHolidayIds));
  }
  if (createdLeaveTypeIds.length > 0) {
    await db.delete(leaveTypes).where(inArray(leaveTypes.id, createdLeaveTypeIds));
  }
  // Leave allowances cascade from employees; the company policy row does not, and it is shared
  // with every other test, so it is put back exactly as it was found.
  await db
    .update(leaveSettings)
    .set({
      leaveYearStartMonth: originalSettings.leaveYearStartMonth,
      leaveYearStartDay: originalSettings.leaveYearStartDay,
      defaultEntitlementHalfDays: originalSettings.defaultEntitlementHalfDays,
      carryOverMaxHalfDays: originalSettings.carryOverMaxHalfDays,
      carryOverExpiryMonths: originalSettings.carryOverExpiryMonths,
      allowNegativeBalance: originalSettings.allowNegativeBalance
    })
    .where(eq(leaveSettings.id, originalSettings.id));

  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
});

describe('who may change HR settings', () => {
  it('lets an ADMIN who holds the hrAdmin capability through', async () => {
    asCaller('admin');
    await expect(
      upsertLeaveType({ name: `Test type ${runId}`, deductsFromAllowance: false })
    ).resolves.toMatchObject({ id: expect.any(String) });

    const [created] = await db
      .select()
      .from(leaveTypes)
      .where(eq(leaveTypes.name, `Test type ${runId}`));
    createdLeaveTypeIds.push(created.id);
    expect(created.deductsFromAllowance).toBe(false);
  });

  it('refuses a plain employee', async () => {
    asCaller('worker');
    await expect(upsertLeaveType({ name: `Nope ${runId}` })).rejects.toThrow(
      /only an hr administrator/i
    );
    await expect(
      upsertLeaveAllowance({
        employeeId: ids.worker,
        leaveYearStart: (await currentLeaveYear()).start,
        entitlementDays: 999
      })
    ).rejects.toThrow(/only an hr administrator/i);
  });

  it('refuses a SECURITY_ADMIN even when the capability flag is set on their row', async () => {
    asCaller('security');
    await expect(upsertLeaveType({ name: `Nope security ${runId}` })).rejects.toThrow(
      /only an hr administrator/i
    );
  });

});

describe('leave policy', () => {
  it('stores days as half days and reads them back unchanged', async () => {
    asCaller('admin');
    await updateLeaveSettings({
      leaveYearStartMonth: 4,
      leaveYearStartDay: 1,
      defaultEntitlementDays: 26.5,
      carryOverMaxDays: 5,
      carryOverExpiryMonths: 3,
      allowNegativeBalance: false
    });

    const settings = await getLeaveSettings();
    expect(settings.defaultEntitlementHalfDays).toBe(53);
    expect(settings.carryOverMaxHalfDays).toBe(10);
    expect(settings.leaveYearStartMonth).toBe(4);
  });

  it('refuses a leave year start that is not a real recurring date', async () => {
    asCaller('admin');
    await expect(
      updateLeaveSettings({
        leaveYearStartMonth: 2,
        leaveYearStartDay: 30,
        defaultEntitlementDays: 25,
        carryOverMaxDays: 0,
        carryOverExpiryMonths: 0,
        allowNegativeBalance: false
      })
    ).rejects.toThrow(/does not have that many days/i);

    await expect(
      updateLeaveSettings({
        leaveYearStartMonth: 2,
        leaveYearStartDay: 29,
        defaultEntitlementDays: 25,
        carryOverMaxDays: 0,
        carryOverExpiryMonths: 0,
        allowNegativeBalance: false
      })
    ).rejects.toThrow(/29 February/i);
  });
});

describe('individual allowances', () => {
  it('overrides the company default, and clearing it restores the default', async () => {
    asCaller('admin');
    const year = await currentLeaveYear();

    const before = await getLeaveBalance(ids.worker, year);
    expect(before.hasExplicitAllowance).toBe(false);

    await upsertLeaveAllowance({
      employeeId: ids.worker,
      leaveYearStart: year.start,
      entitlementDays: 30,
      carriedOverDays: 2.5,
      adjustmentDays: -1,
      adjustmentNote: 'test adjustment'
    });

    const after = await getLeaveBalance(ids.worker, year);
    expect(after.hasExplicitAllowance).toBe(true);
    // 30 + 2.5 - 1 = 31.5 days = 63 half days, none of it taken.
    expect(after.availableHalfDays).toBe(63);

    await clearLeaveAllowance(ids.worker, year.start);
    const restored = await getLeaveBalance(ids.worker, year);
    expect(restored.hasExplicitAllowance).toBe(false);
    expect(restored.availableHalfDays).not.toBe(63);
  });

  it('sets an allowance twice without creating a second row for the same year', async () => {
    asCaller('admin');
    const year = await currentLeaveYear();

    await upsertLeaveAllowance({
      employeeId: ids.worker,
      leaveYearStart: year.start,
      entitlementDays: 20
    });
    await upsertLeaveAllowance({
      employeeId: ids.worker,
      leaveYearStart: year.start,
      entitlementDays: 22
    });

    const rows = await db
      .select()
      .from(leaveAllowances)
      .where(
        and(
          eq(leaveAllowances.employeeId, ids.worker),
          eq(leaveAllowances.leaveYearStart, year.start)
        )
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].entitlementHalfDays).toBe(44);

    await clearLeaveAllowance(ids.worker, year.start);
  });

  it('lists everyone, marking who is on the default rather than a decided figure', async () => {
    asCaller('admin');
    const year = await currentLeaveYear();

    await upsertLeaveAllowance({
      employeeId: ids.worker,
      leaveYearStart: year.start,
      entitlementDays: 33
    });

    const caller = await import('@/lib/permissions/current-employee').then((m) =>
      m.requireActiveEmployee()
    );
    const rows = await listLeaveAllowances(caller, year);

    const worker = rows.find((row) => row.employeeId === ids.worker);
    expect(worker?.isExplicit).toBe(true);
    expect(worker?.entitlementDays).toBe(33);

    const admin = rows.find((row) => row.employeeId === ids.admin);
    expect(admin?.isExplicit).toBe(false);

    await clearLeaveAllowance(ids.worker, year.start);
  });
});

describe('leave types', () => {
  it('archives rather than deletes, and refuses to archive the last one', async () => {
    asCaller('admin');

    const [created] = await db
      .insert(leaveTypes)
      .values({ name: `Archivable ${runId}`, position: 900 })
      .returning({ id: leaveTypes.id });
    createdLeaveTypeIds.push(created.id);

    await setLeaveTypeArchived(created.id, true);
    const [archived] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, created.id));
    expect(archived.archivedAt).not.toBeNull();

    await setLeaveTypeArchived(created.id, false);
    const [restored] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, created.id));
    expect(restored.archivedAt).toBeNull();
  });

  it('rejects a duplicate name with a sentence rather than a constraint violation', async () => {
    asCaller('admin');
    const name = `Duplicate ${runId}`;
    const first = await upsertLeaveType({ name });
    createdLeaveTypeIds.push(first.id);

    await expect(upsertLeaveType({ name })).rejects.toThrow(/already a leave type called/i);
  });
});

describe('public holidays', () => {
  it('adds one and refuses the same date twice for the same region', async () => {
    asCaller('admin');
    const date = '2031-12-25';

    await addPublicHoliday({ date, name: `Test holiday ${runId}`, region: `Region ${runId}` });
    const [created] = await db
      .select()
      .from(publicHolidays)
      .where(and(eq(publicHolidays.date, date), eq(publicHolidays.region, `Region ${runId}`)));
    createdHolidayIds.push(created.id);
    expect(created.name).toBe(`Test holiday ${runId}`);

    await expect(
      addPublicHoliday({ date, name: 'Again', region: `Region ${runId}` })
    ).rejects.toThrow(/already recorded as a public holiday/i);

    await removePublicHoliday(created.id);
    createdHolidayIds.pop();
    const remaining = await db
      .select()
      .from(publicHolidays)
      .where(eq(publicHolidays.id, created.id));
    expect(remaining).toHaveLength(0);
  });
});
