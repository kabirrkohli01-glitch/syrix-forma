import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { closeSickness, recordReturnToWork, recordSickness } =
  await import('@/features/hr/absence-actions');
const { listAbsenceRecords } = await import('@/features/hr/utils/absence-queries');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = {
  worker: `test_${runId}_worker`,
  manager: `test_${runId}_manager`,
  hr: `test_${runId}_hr`
};
const ids = { worker: '', manager: '', hr: '' };

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
        name: 'Absence Test Manager',
        email: `${clerkIds.manager}@example.test`,
        role: 'MANAGER',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.hr,
        name: 'Absence Test HR',
        email: `${clerkIds.hr}@example.test`,
        role: 'HR_ADMIN',
        team: null,
        status: 'active'
      }
    ])
    .returning({ id: employees.id, clerkUserId: employees.clerkUserId });

  ids.manager = inserted.find((r) => r.clerkUserId === clerkIds.manager)!.id;
  ids.hr = inserted.find((r) => r.clerkUserId === clerkIds.hr)!.id;

  const [worker] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIds.worker,
      name: 'Absence Test Worker',
      email: `${clerkIds.worker}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active',
      managerId: ids.manager
    })
    .returning({ id: employees.id });
  ids.worker = worker.id;
});

afterAll(async () => {
  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
});

describe('recording absence', () => {
  let recordId = '';

  it('lets an employee record their own, open-ended', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    const result = await recordSickness({
      startDate: '2026-06-01',
      category: 'Musculoskeletal',
      notes: 'Back injury, seeing a physiotherapist'
    });
    recordId = result.id;
    expect(recordId).toBeTruthy();
  });

  it('refuses a second open absence for the same person', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await expect(recordSickness({ startDate: '2026-06-10' })).rejects.toThrow(/still open/i);
  });

  it('withholds the medical detail from the line manager but shows them the dates', async () => {
    const asManager = await listAbsenceRecords(caller('manager', { role: 'MANAGER' }));
    const row = asManager.find((r) => r.id === recordId);

    expect(row).toBeDefined();
    expect(row!.startDate).toBe('2026-06-01');
    // The manager needs to know their report is off. They have no business knowing why.
    expect(row!.medical).toBeNull();
  });

  it('shows the medical detail to the employee themselves', async () => {
    const asWorker = await listAbsenceRecords(caller('worker', { managerId: ids.manager }));
    const row = asWorker.find((r) => r.id === recordId);
    expect(row!.medical?.category).toBe('Musculoskeletal');
    expect(row!.medical?.notes).toContain('physiotherapist');
  });

  it('shows the medical detail to HR', async () => {
    const asHr = await listAbsenceRecords(caller('hr', { role: 'HR_ADMIN' }));
    const row = asHr.find((r) => r.id === recordId);
    expect(row!.medical?.category).toBe('Musculoskeletal');
  });

  it('shows nothing at all to SECURITY_ADMIN', async () => {
    const asSecurity = await listAbsenceRecords(caller('hr', { role: 'SECURITY_ADMIN' }));
    expect(asSecurity).toEqual([]);
  });

  it('computes working days lost when the absence is closed', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    // Mon 1 June to Fri 5 June 2026 inclusive: five working days.
    await closeSickness({ sicknessRecordId: recordId, endDate: '2026-06-05' });

    const rows = await listAbsenceRecords(caller('hr', { role: 'HR_ADMIN' }));
    const row = rows.find((r) => r.id === recordId);
    expect(row!.endDate).toBe('2026-06-05');
    expect(row!.totalHalfDays).toBe(10);
  });

  it('refuses a return date before the absence started', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await expect(
      closeSickness({ sicknessRecordId: recordId, endDate: '2026-05-01' })
    ).rejects.toThrow(/cannot be before/i);
  });

  it('refuses to let someone hold a return-to-work interview with themselves', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await expect(
      recordReturnToWork({ sicknessRecordId: recordId, conductedOn: '2026-06-05' })
    ).rejects.toThrow(/cannot record a return-to-work/i);
  });

  it('lets the line manager record the interview', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await recordReturnToWork({
      sicknessRecordId: recordId,
      conductedOn: '2026-06-05',
      notes: 'Fit to return, no adjustments needed'
    });

    const rows = await listAbsenceRecords(caller('hr', { role: 'HR_ADMIN' }));
    expect(rows.find((r) => r.id === recordId)!.hasReturnToWork).toBe(true);
  });
});
