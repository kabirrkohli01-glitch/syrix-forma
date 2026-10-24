import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees, expenseCategories, expenseClaims, shifts } from '@/lib/db/schema';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const {
  acceptShiftSwap,
  addExpenseItem,
  addTimesheetEntry,
  approveShiftSwap,
  clock,
  createExpenseClaim,
  createShift,
  decideExpenseClaim,
  decideTimesheet,
  markExpenseClaimPaid,
  requestShiftSwap,
  submitExpenseClaim,
  submitTimesheet
} = await import('@/features/hr/work-actions');
const { listTimesheets, weekStartFor } = await import('@/features/hr/utils/work-queries');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = {
  worker: `test_${runId}_worker`,
  peer: `test_${runId}_peer`,
  manager: `test_${runId}_manager`,
  finance: `test_${runId}_finance`
};
const ids = { worker: '', peer: '', manager: '', finance: '' };
let mileageCategoryId = '';
let travelCategoryId = '';

function caller(
  key: keyof typeof clerkIds,
  overrides: Partial<ActiveEmployee> = {}
): ActiveEmployee {
  return {
    id: ids[key],
    clerkUserId: clerkIds[key],
    name: key,
    displayName: key,
    email: `${clerkIds[key]}@example.test`,
    role: 'EMPLOYEE',
    team: 'alpha',
    managerId: null,
    financeAccess: false,
    hrAdmin: false,
    ...overrides
  };
}

beforeAll(async () => {
  const inserted = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.manager,
        name: 'Work Test Manager',
        email: `${clerkIds.manager}@example.test`,
        role: 'MANAGER',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.finance,
        name: 'Work Test Finance',
        email: `${clerkIds.finance}@example.test`,
        role: 'EMPLOYEE',
        team: 'alpha',
        status: 'active',
        financeAccess: true
      }
    ])
    .returning({ id: employees.id, clerkUserId: employees.clerkUserId });

  ids.manager = inserted.find((r) => r.clerkUserId === clerkIds.manager)!.id;
  ids.finance = inserted.find((r) => r.clerkUserId === clerkIds.finance)!.id;

  const reports = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.worker,
        name: 'Work Test Worker',
        email: `${clerkIds.worker}@example.test`,
        role: 'EMPLOYEE',
        team: 'alpha',
        status: 'active',
        managerId: ids.manager
      },
      {
        clerkUserId: clerkIds.peer,
        name: 'Work Test Peer',
        email: `${clerkIds.peer}@example.test`,
        role: 'EMPLOYEE',
        team: 'alpha',
        status: 'active',
        managerId: ids.manager
      }
    ])
    .returning({ id: employees.id, clerkUserId: employees.clerkUserId });

  ids.worker = reports.find((r) => r.clerkUserId === clerkIds.worker)!.id;
  ids.peer = reports.find((r) => r.clerkUserId === clerkIds.peer)!.id;

  const categories = await db.select().from(expenseCategories);
  mileageCategoryId = categories.find((c) => c.isMileage)!.id;
  travelCategoryId = categories.find((c) => c.name === 'Travel')!.id;
});

afterAll(async () => {
  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
});

describe('weekStartFor', () => {
  it('returns the Monday of that week', () => {
    // 2026-06-10 is a Wednesday; 2026-06-08 is the Monday.
    expect(weekStartFor('2026-06-10')).toBe('2026-06-08');
    expect(weekStartFor('2026-06-08')).toBe('2026-06-08');
  });

  it('puts Sunday at the end of its week, not the start of the next', () => {
    // 2026-06-14 is a Sunday and belongs to the week beginning Monday the 8th.
    expect(weekStartFor('2026-06-14')).toBe('2026-06-08');
  });
});

describe('rota and shift swaps', () => {
  let shiftId = '';
  let swapId = '';

  it('refuses an employee scheduling a shift for someone else', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await expect(
      createShift({ employeeId: ids.peer, onDate: '2026-07-06', startMinute: 540, endMinute: 1020 })
    ).rejects.toThrow(/cannot schedule shifts/i);
  });

  it('lets the line manager schedule one, unpublished', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    const created = await createShift({
      employeeId: ids.worker,
      onDate: '2026-07-06',
      startMinute: 540,
      endMinute: 1020,
      unpaidBreakMinutes: 60
    });
    shiftId = created.id;

    const [row] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    expect(row.publishedAt).toBeNull();
  });

  it('only lets the rostered person offer their own shift away', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.peer });
    await expect(requestShiftSwap({ shiftId })).rejects.toThrow(/only offer your own/i);

    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    const created = await requestShiftSwap({ shiftId, offeredToEmployeeId: ids.peer });
    swapId = created.id;
  });

  it('does not move the rota when a colleague merely accepts', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.peer });
    await acceptShiftSwap({ swapId });

    const [row] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    // Still the original person: acceptance alone must not rewrite a published rota.
    expect(row.employeeId).toBe(ids.worker);
  });

  it('refuses to let either party approve their own swap', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await expect(approveShiftSwap({ swapId })).rejects.toThrow(/cannot approve/i);

    mockAuth.mockResolvedValue({ userId: clerkIds.peer });
    await expect(approveShiftSwap({ swapId })).rejects.toThrow(/cannot approve/i);
  });

  it('moves the shift once the manager approves', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await approveShiftSwap({ swapId });

    const [row] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    expect(row.employeeId).toBe(ids.peer);
  });
});

describe('clocking', () => {
  it('refuses to clock out when not clocked in', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await expect(clock({ eventType: 'out' })).rejects.toThrow(/not clocked in/i);
  });

  it('refuses a second clock-in', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await clock({ eventType: 'in' });
    await expect(clock({ eventType: 'in' })).rejects.toThrow(/already clocked in/i);
  });

  it('refuses to end a break that never started', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await expect(clock({ eventType: 'break_end' })).rejects.toThrow(/not on a break/i);
  });

  it('accepts a full break and clock-out sequence', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await clock({ eventType: 'break_start' });
    await clock({ eventType: 'break_end' });
    await clock({ eventType: 'out' });
  });
});

describe('timesheets', () => {
  let timesheetId = '';

  it('creates the week on first entry', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    const result = await addTimesheetEntry({ onDate: '2026-07-08', minutes: 480 });
    timesheetId = result.timesheetId;

    const sheets = await listTimesheets(caller('worker', { managerId: ids.manager }));
    const sheet = sheets.find((s) => s.id === timesheetId);
    expect(sheet!.weekStart).toBe('2026-07-06');
    expect(sheet!.totalMinutes).toBe(480);
  });

  it('sums several entries in the same week', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await addTimesheetEntry({ onDate: '2026-07-09', minutes: 450 });

    const sheets = await listTimesheets(caller('worker', { managerId: ids.manager }));
    expect(sheets.find((s) => s.id === timesheetId)!.totalMinutes).toBe(930);
  });

  it('refuses to let the employee approve their own hours', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await submitTimesheet({ timesheetId });
    await expect(decideTimesheet({ timesheetId, decision: 'approved' })).rejects.toThrow(
      /cannot decide/i
    );
  });

  it('lets the line manager approve', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await decideTimesheet({ timesheetId, decision: 'approved' });

    const sheets = await listTimesheets(caller('manager', { role: 'MANAGER' }));
    expect(sheets.find((s) => s.id === timesheetId)!.status).toBe('approved');
  });
});

describe('expenses', () => {
  let claimId = '';

  it('starts as a draft with no total', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    const created = await createExpenseClaim({ title: 'July travel' });
    claimId = created.id;

    const [row] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, claimId));
    expect(row.status).toBe('draft');
    expect(row.totalPence).toBe(0);
  });

  it('parses a cash amount into exact pence and keeps the claim total in step', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    const result = await addExpenseItem({
      claimId,
      categoryId: travelCategoryId,
      description: 'Train to client site',
      spentOn: '2026-07-08',
      amount: '48.35'
    });
    expect(result.amountPence).toBe(4_835);

    const [row] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, claimId));
    expect(row.totalPence).toBe(4_835);
  });

  it('calculates mileage server-side from the rate in force on the journey date', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    // 8 July 2026 falls in the 2026/27 tax year, so the car rate is 55p for the first
    // 10,000 miles — not the 45p that applied before 6 April 2026.
    const result = await addExpenseItem({
      claimId,
      categoryId: mileageCategoryId,
      description: 'Drive to site',
      spentOn: '2026-07-08',
      miles: 100
    });
    expect(result.amountPence).toBe(5_500);
  });

  it('uses the older rate for a journey made before the change', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    const result = await addExpenseItem({
      claimId,
      categoryId: mileageCategoryId,
      description: 'Drive to site, March',
      spentOn: '2026-03-02',
      miles: 100
    });
    expect(result.amountPence).toBe(4_500);
  });

  it('refuses an item over the category cap', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await expect(
      addExpenseItem({
        claimId,
        categoryId: travelCategoryId,
        description: 'A very expensive train',
        spentOn: '2026-07-08',
        amount: '900.00'
      })
    ).rejects.toThrow(/capped at/i);
  });

  it('refuses a colleague adding to someone else’s claim', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.peer });
    await expect(
      addExpenseItem({
        claimId,
        categoryId: travelCategoryId,
        description: 'Not mine',
        spentOn: '2026-07-08',
        amount: '10.00'
      })
    ).rejects.toThrow(/cannot add to that claim/i);
  });

  it('refuses the claimant approving their own spend', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await submitExpenseClaim({ claimId });
    await expect(decideExpenseClaim({ claimId, decision: 'approved' })).rejects.toThrow(
      /cannot decide/i
    );
  });

  it('refuses payment before approval', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.finance });
    await expect(markExpenseClaimPaid({ claimId })).rejects.toThrow(/only an approved claim/i);
  });

  it('approves, then pays, as two separate acts', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await decideExpenseClaim({ claimId, decision: 'approved' });

    // A line manager can approve but is not finance, so cannot mark it paid.
    await expect(markExpenseClaimPaid({ claimId })).rejects.toThrow(/only finance/i);

    mockAuth.mockResolvedValue({ userId: clerkIds.finance });
    await markExpenseClaimPaid({ claimId });

    const [row] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, claimId));
    expect(row.status).toBe('paid');
    expect(row.paidAt).not.toBeNull();
  });
});
