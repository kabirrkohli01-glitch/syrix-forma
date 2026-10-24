import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { auditLog, employees, notifications } from '@/lib/db/schema';
import { LOCKOUT_LADDER_MINUTES } from '@/lib/auth/lockout';

// Email is a side effect with a real provider behind it; the assertions here are about the row
// and the in-app notification, both of which are checked for real against the database.
const sendEmail = vi.fn(async () => ({ ok: true as const }));
vi.mock('@/lib/notifications/email', () => ({ sendEmail: () => sendEmail() }));

const { recordLockout } = await import('@/lib/auth/record-lockout');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = {
  admin: `test_${runId}_admin`,
  target: `test_${runId}_target`
};
const ids = { admin: '', target: '' };

beforeAll(async () => {
  const rows = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.admin,
        name: `Lockout Admin ${runId}`,
        email: `${clerkIds.admin}@example.test`,
        role: 'ADMIN',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.target,
        name: `Lockout Target ${runId}`,
        email: `${clerkIds.target}@example.test`,
        role: 'EMPLOYEE',
        status: 'active'
      }
    ])
    .returning();

  for (const row of rows) {
    if (row.clerkUserId === clerkIds.admin) ids.admin = row.id;
    if (row.clerkUserId === clerkIds.target) ids.target = row.id;
  }
});

afterAll(async () => {
  await db.delete(notifications).where(inArray(notifications.employeeId, Object.values(ids)));
  await db.delete(auditLog).where(eq(auditLog.resourceId, ids.target));
  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
});

beforeEach(async () => {
  sendEmail.mockClear();
  await db.delete(notifications).where(eq(notifications.employeeId, ids.admin));
  await db
    .update(employees)
    .set({ lockedUntil: null, lockoutCount: 0, lockoutCountResetAt: null })
    .where(eq(employees.id, ids.target));
});

async function targetRow() {
  const [row] = await db.select().from(employees).where(eq(employees.id, ids.target)).limit(1);
  return row;
}

describe('recording a lockout', () => {
  it('locks the account and tells every administrator', async () => {
    const before = Date.now();
    await recordLockout(clerkIds.target);

    const row = await targetRow();
    expect(row.lockoutCount).toBe(1);
    expect(row.lockedUntil).not.toBeNull();
    // The first rung, give or take the time the test itself took.
    const heldForMinutes = (row.lockedUntil!.getTime() - before) / 60_000;
    expect(heldForMinutes).toBeGreaterThan(LOCKOUT_LADDER_MINUTES[0] - 1);
    expect(heldForMinutes).toBeLessThan(LOCKOUT_LADDER_MINUTES[0] + 1);

    const alerts = await db
      .select()
      .from(notifications)
      .where(eq(notifications.employeeId, ids.admin));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('account_locked_out');
    expect(alerts[0].body).toContain(`${clerkIds.target}@example.test`);

    // Once per active administrator. Counted from the database rather than hard-coded, because
    // this suite runs against the real one and the number of administrators is not the test's
    // to decide — asserting "exactly one" only passes on an empty installation.
    const adminCount = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.role, 'ADMIN'), eq(employees.status, 'active')));
    expect(sendEmail).toHaveBeenCalledTimes(adminCount.length);
  });

  it('holds a repeat offender for longer than the first time', async () => {
    await recordLockout(clerkIds.target);
    const first = await targetRow();

    // Expire the first lockout rather than waiting it out, then trigger a second.
    await db
      .update(employees)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(employees.id, ids.target));

    const secondStart = Date.now();
    await recordLockout(clerkIds.target);
    const second = await targetRow();

    expect(second.lockoutCount).toBe(2);
    const firstHeld = first.lockedUntil!.getTime() - first.updatedAt.getTime();
    const secondHeld = second.lockedUntil!.getTime() - secondStart;
    expect(secondHeld).toBeGreaterThan(firstHeld);
  });

  it('ignores a repeat event while the account is already locked', async () => {
    // Clerk's user.updated fires for every change to a user and a locked user stays locked
    // across all of them, so without this one real lockout would climb several rungs.
    await recordLockout(clerkIds.target);
    const afterFirst = await targetRow();

    expect(await recordLockout(clerkIds.target)).toBeNull();
    expect(await recordLockout(clerkIds.target)).toBeNull();

    const afterRepeats = await targetRow();
    expect(afterRepeats.lockoutCount).toBe(1);
    expect(afterRepeats.lockedUntil).toEqual(afterFirst.lockedUntil);

    const alerts = await db
      .select()
      .from(notifications)
      .where(eq(notifications.employeeId, ids.admin));
    expect(alerts).toHaveLength(1);
  });

  it('does nothing for a Clerk account that has never reached the Hub', async () => {
    // A Clerk user can be locked before they have ever been approved into the Hub.
    expect(await recordLockout(`test_${runId}_stranger`)).toBeNull();
  });

  it('writes an audit entry with no actor, because nobody chose to do this', async () => {
    await recordLockout(clerkIds.target);

    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.resourceId, ids.target));
    const lockouts = entries.filter((e) => e.action === 'account_locked_out');

    expect(lockouts.length).toBeGreaterThanOrEqual(1);
    expect(lockouts.at(-1)!.actorEmployeeId).toBeNull();
  });
});
