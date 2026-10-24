import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';

const mockAuth = vi.fn();
const banUser = vi.fn();
const unbanUser = vi.fn();

vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
  // The actions ban and unban at the identity provider as well as writing the row. Asserting
  // those calls is the point of several tests below: a refusal that only changed the Hub's own
  // status would leave the account free to keep signing in and knocking at the gate.
  clerkClient: async () => ({ users: { banUser, unbanUser } })
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { approveEmployee, rejectEmployee } = await import('@/features/access-control/actions');

const TEST_SESSION = 'sess_test_step_up';

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = {
  admin: `test_${runId}_admin`,
  applicant: `test_${runId}_applicant`,
  staff: `test_${runId}_staff`
};
const ids: Record<keyof typeof clerkIds, string> = { admin: '', applicant: '', staff: '' };

beforeAll(async () => {
  const rows = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.admin,
        name: `Approval Admin ${runId}`,
        email: `${clerkIds.admin}@example.test`,
        role: 'ADMIN',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.applicant,
        name: `Applicant ${runId}`,
        email: `${clerkIds.applicant}@example.test`,
        role: null,
        status: 'pending'
      },
      {
        clerkUserId: clerkIds.staff,
        name: `Existing Staff ${runId}`,
        email: `${clerkIds.staff}@example.test`,
        role: 'EMPLOYEE',
        status: 'active'
      }
    ])
    .returning();

  for (const row of rows) {
    if (row.clerkUserId === clerkIds.admin) ids.admin = row.id;
    if (row.clerkUserId === clerkIds.applicant) ids.applicant = row.id;
    if (row.clerkUserId === clerkIds.staff) ids.staff = row.id;
  }
});

afterAll(async () => {
  for (const id of Object.values(ids)) {
    if (id) await db.delete(employees).where(eq(employees.id, id));
  }
});

beforeEach(async () => {
  banUser.mockReset();
  unbanUser.mockReset();
  mockAuth.mockResolvedValue({ userId: clerkIds.admin, sessionId: TEST_SESSION });
  await db
    .update(employees)
    .set({ stepUpVerifiedAt: new Date(), stepUpSessionId: TEST_SESSION })
    .where(eq(employees.id, ids.admin));
  await db
    .update(employees)
    .set({ status: 'pending', role: null })
    .where(eq(employees.id, ids.applicant));
});

async function statusOf(employeeId: string) {
  const [row] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  return row;
}

describe('refusing a request for access', () => {
  it('marks the account refused and bans it at the identity provider', async () => {
    await rejectEmployee(ids.applicant);

    const row = await statusOf(ids.applicant);
    expect(row.status).toBe('rejected');
    expect(row.role).toBeNull();
    expect(banUser).toHaveBeenCalledWith(clerkIds.applicant);
  });

  it('refuses to act on somebody who already works here', async () => {
    // Withdrawing access from an active employee is offboarding, which has to hand their work
    // on. Routing it through this action would leave that work owned by an unreachable account.
    await expect(rejectEmployee(ids.staff)).rejects.toThrow(/waiting for approval/);
    expect(await statusOf(ids.staff).then((r) => r.status)).toBe('active');
    expect(banUser).not.toHaveBeenCalled();
  });

  it('cannot be done by someone who is not an administrator', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.staff, sessionId: TEST_SESSION });
    await expect(rejectEmployee(ids.applicant)).rejects.toThrow();
    expect(await statusOf(ids.applicant).then((r) => r.status)).toBe('pending');
    expect(banUser).not.toHaveBeenCalled();
  });
});

describe('approving', () => {
  it('grants the role and team asked for', async () => {
    await approveEmployee(ids.applicant, 'EMPLOYEE', 'immigration');

    const row = await statusOf(ids.applicant);
    expect(row.status).toBe('active');
    expect(row.role).toBe('EMPLOYEE');
    expect(row.team).toBe('immigration');
    // Nothing to lift: this account was never banned.
    expect(unbanUser).not.toHaveBeenCalled();
  });

  it('lifts the ban when letting in an account that was previously refused', async () => {
    await rejectEmployee(ids.applicant);
    expect(await statusOf(ids.applicant).then((r) => r.status)).toBe('rejected');

    await approveEmployee(ids.applicant, 'EMPLOYEE', '');

    // Without this the row would read 'active' while Clerk went on refusing every sign-in —
    // the Hub claiming access it had not actually restored.
    expect(unbanUser).toHaveBeenCalledWith(clerkIds.applicant);
    expect(await statusOf(ids.applicant).then((r) => r.status)).toBe('active');
  });
});
