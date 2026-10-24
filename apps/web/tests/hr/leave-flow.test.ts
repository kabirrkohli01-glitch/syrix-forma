import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { calendarEvents, employees, leaveRequests, leaveTypes } from '@/lib/db/schema';

// Only auth() is faked — the actions, permission checks, balance arithmetic and database
// writes all run for real, same convention as tests/chat/chat-authorization.test.ts.
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { cancelLeaveRequest, decideLeaveRequest, requestLeave } =
  await import('@/features/hr/leave-actions');
const { getLeaveBalance, listPendingApprovals } = await import('@/features/hr/utils/leave-queries');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = {
  worker: `test_${runId}_worker`,
  manager: `test_${runId}_manager`,
  stranger: `test_${runId}_stranger`,
  hr: `test_${runId}_hr`
};

const ids = { worker: '', manager: '', stranger: '', hr: '' };
let holidayTypeId = '';
let unpaidTypeId = '';

function asCaller(key: keyof typeof clerkIds) {
  mockAuth.mockResolvedValue({ userId: clerkIds[key] });
}

/** Mondays well clear of weekends and of the seeded bank holidays. */
const WEEK_A_START = '2026-06-08';
const WEEK_A_END = '2026-06-12';
const WEEK_B_START = '2026-07-06';
const WEEK_B_END = '2026-07-07';

beforeAll(async () => {
  const inserted = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.manager,
        name: 'Leave Test Manager',
        email: `${clerkIds.manager}@example.test`,
        role: 'MANAGER',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.stranger,
        name: 'Leave Test Stranger',
        email: `${clerkIds.stranger}@example.test`,
        role: 'TEAM_LEAD',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.hr,
        name: 'Leave Test HR',
        email: `${clerkIds.hr}@example.test`,
        role: 'HR_ADMIN',
        team: null,
        status: 'active'
      }
    ])
    .returning({ id: employees.id, clerkUserId: employees.clerkUserId });

  for (const row of inserted) {
    const key = (Object.keys(clerkIds) as (keyof typeof clerkIds)[]).find(
      (k) => clerkIds[k] === row.clerkUserId
    );
    if (key) ids[key] = row.id;
  }

  const [worker] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIds.worker,
      name: 'Leave Test Worker',
      email: `${clerkIds.worker}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active',
      managerId: ids.manager
    })
    .returning({ id: employees.id });
  ids.worker = worker.id;

  const types = await db.select().from(leaveTypes);
  holidayTypeId = types.find((t) => t.name === 'Holiday')!.id;
  unpaidTypeId = types.find((t) => t.name === 'Unpaid leave')!.id;
});

afterAll(async () => {
  const requests = await db
    .select({ id: leaveRequests.id, calendarEventId: leaveRequests.calendarEventId })
    .from(leaveRequests)
    .where(inArray(leaveRequests.employeeId, Object.values(ids).filter(Boolean)));

  const eventIds = requests.map((r) => r.calendarEventId).filter((id): id is string => Boolean(id));
  if (eventIds.length > 0) {
    await db.delete(calendarEvents).where(inArray(calendarEvents.id, eventIds));
  }
  // leave_requests cascade from employees, but the calendar events they created do not —
  // deleting only the employees would leave orphaned all-day events on the shared calendar.
  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
});

describe('booking leave', () => {
  it('costs the right number of days and lands as pending', async () => {
    asCaller('worker');
    const result = await requestLeave({
      leaveTypeId: holidayTypeId,
      startDate: WEEK_A_START,
      endDate: WEEK_A_END
    });

    // Mon-Fri with no bank holiday in that week: five days, ten half days.
    expect(result.totalHalfDays).toBe(10);
    expect(result.autoApproved).toBe(false);

    const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, result.id));
    expect(row.status).toBe('pending');
    expect(row.calendarEventId).toBeNull();
  });

  it('counts a pending request against what is still bookable', async () => {
    const balance = await getLeaveBalance(ids.worker);
    expect(balance.pendingHalfDays).toBe(10);
    expect(balance.takenHalfDays).toBe(0);
    expect(balance.availableHalfDays).toBe(balance.totalHalfDays - 10);
  });

  it('refuses a second request overlapping the first', async () => {
    asCaller('worker');
    await expect(
      requestLeave({
        leaveTypeId: holidayTypeId,
        startDate: '2026-06-10',
        endDate: '2026-06-15'
      })
    ).rejects.toThrow(/overlaps/i);
  });

  it('refuses a range containing no working days', async () => {
    asCaller('worker');
    await expect(
      // 13 and 14 June 2026 are a Saturday and Sunday.
      requestLeave({ leaveTypeId: holidayTypeId, startDate: '2026-06-13', endDate: '2026-06-14' })
    ).rejects.toThrow(/no working days/i);
  });

  it('excludes a bank holiday from the days charged', async () => {
    asCaller('worker');
    // The week containing Monday 25 May 2026, the Spring bank holiday: four days, not five.
    const result = await requestLeave({
      leaveTypeId: holidayTypeId,
      startDate: '2026-05-25',
      endDate: '2026-05-29'
    });
    expect(result.totalHalfDays).toBe(8);
  });

  it('does not draw down the allowance for a type that does not deduct', async () => {
    const before = await getLeaveBalance(ids.worker);
    asCaller('worker');
    await requestLeave({
      leaveTypeId: unpaidTypeId,
      startDate: WEEK_B_START,
      endDate: WEEK_B_END
    });
    const after = await getLeaveBalance(ids.worker);
    expect(after.pendingHalfDays).toBe(before.pendingHalfDays);
  });
});

describe('who may decide a request', () => {
  let pendingId = '';

  beforeAll(async () => {
    const [row] = await db
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(eq(leaveRequests.employeeId, ids.worker))
      .limit(1);
    pendingId = row.id;
  });

  it('puts the request in the line manager’s queue and nobody else’s', async () => {
    const managerQueue = await listPendingApprovals({
      id: ids.manager,
      clerkUserId: clerkIds.manager,
      name: 'm',
      displayName: 'm',
      email: 'm@example.test',
      role: 'MANAGER',
      team: 'alpha',
      managerId: null,
      financeAccess: false,
      hrAdmin: false
    });
    expect(managerQueue.some((r) => r.employeeId === ids.worker)).toBe(true);

    // A TEAM_LEAD on the same team is not the line manager, so sees none of it.
    const strangerQueue = await listPendingApprovals({
      id: ids.stranger,
      clerkUserId: clerkIds.stranger,
      name: 's',
      displayName: 's',
      email: 's@example.test',
      role: 'TEAM_LEAD',
      team: 'alpha',
      managerId: null,
      financeAccess: false,
      hrAdmin: false
    });
    expect(strangerQueue.some((r) => r.employeeId === ids.worker)).toBe(false);
  });

  it('rejects a same-team colleague who is not the line manager', async () => {
    asCaller('stranger');
    await expect(
      decideLeaveRequest({ requestId: pendingId, decision: 'approved' })
    ).rejects.toThrow(/cannot decide/i);
  });

  it('rejects the requester approving their own leave', async () => {
    asCaller('worker');
    await expect(
      decideLeaveRequest({ requestId: pendingId, decision: 'approved' })
    ).rejects.toThrow(/cannot decide/i);
  });

  it('lets the line manager approve, and writes it to the shared calendar', async () => {
    asCaller('manager');
    await decideLeaveRequest({ requestId: pendingId, decision: 'approved' });

    const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, pendingId));
    expect(row.status).toBe('approved');
    expect(row.decidedByEmployeeId).toBe(ids.manager);
    expect(row.calendarEventId).not.toBeNull();

    const [event] = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, row.calendarEventId!));
    expect(event.allDay).toBe(true);
    expect(event.title).toContain('Leave Test Worker');
  });

  it('moves an approved request from pending to taken in the balance', async () => {
    const balance = await getLeaveBalance(ids.worker);
    expect(balance.takenHalfDays).toBeGreaterThanOrEqual(10);
  });

  it('refuses to decide a request that has already been decided', async () => {
    asCaller('manager');
    await expect(
      decideLeaveRequest({ requestId: pendingId, decision: 'declined' })
    ).rejects.toThrow(/already been approved/i);
  });

  it('removes the calendar entry when the booking is cancelled', async () => {
    const [before] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, pendingId));
    const eventId = before.calendarEventId!;

    asCaller('worker');
    await cancelLeaveRequest({ requestId: pendingId });

    const [after] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, pendingId));
    expect(after.status).toBe('cancelled');
    expect(after.calendarEventId).toBeNull();

    const events = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId));
    expect(events).toHaveLength(0);
  });

  it('frees the days back up once cancelled', async () => {
    const balance = await getLeaveBalance(ids.worker);
    // The cancelled week no longer counts as taken; the bank-holiday week is still pending.
    expect(balance.takenHalfDays).toBe(0);
  });
});

describe('booking on someone else’s behalf', () => {
  it('refuses a line manager booking leave in their report’s name', async () => {
    asCaller('manager');
    await expect(
      requestLeave({
        employeeId: ids.worker,
        leaveTypeId: holidayTypeId,
        startDate: '2026-09-07',
        endDate: '2026-09-08'
      })
    ).rejects.toThrow(/cannot book leave for that person/i);
  });

  it('allows HR to book on behalf of someone', async () => {
    asCaller('hr');
    const result = await requestLeave({
      employeeId: ids.worker,
      leaveTypeId: holidayTypeId,
      startDate: '2026-09-07',
      endDate: '2026-09-08'
    });
    expect(result.totalHalfDays).toBe(4);
  });
});
