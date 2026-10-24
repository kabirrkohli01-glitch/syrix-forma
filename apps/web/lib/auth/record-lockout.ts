/**
 * Writing a lockout to an employee's row, and telling the administrators it happened.
 *
 * Split from lib/auth/lockout.ts, which is pure arithmetic and testable without a database. This
 * is the side-effecting half: the update and the alert.
 *
 * The trigger is Clerk's own `user.updated` webhook reporting `locked: true` — Clerk does the
 * counting of failed passwords, because the sign-in form is Clerk's and failed attempts never
 * reach this server. What Clerk does not do is make the second lockout cost more than the first,
 * or tell anybody. That is what this adds.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { resolveDisplayName } from '@/lib/db/display-name';
import { employees } from '@/lib/db/schema';
import { sendEmail } from '@/lib/notifications/email';
import { createNotification } from '@/lib/notifications/in-app';
import { logAuditEvent } from '@/lib/permissions/audit';
import { isCurrentlyLockedOut, minutesRemaining, nextLockoutState } from './lockout';

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
}

/** Describes a wait in words rather than a timestamp. */
function describeWait(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour' : `${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'a day' : `${days} days`;
}

/**
 * Records a lockout for the Clerk user, lengthening it if this account has been locked recently.
 *
 * Returns null when there is no employee row for that Clerk id — a Clerk account can be locked
 * before it has ever reached the Hub, and that is not an error.
 */
export async function recordLockout(clerkUserId: string, now = new Date()) {
  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.clerkUserId, clerkUserId))
    .limit(1);
  if (!employee) return null;

  // Already serving one. `user.updated` fires for every change to a Clerk user, and a locked
  // user stays locked across all of them, so without this any unrelated edit — or a webhook
  // Clerk retried — would read as a fresh lockout and push this account up the ladder for a
  // single real event. One lockout, one step.
  if (isCurrentlyLockedOut(employee, now)) return null;

  const next = nextLockoutState(employee, now);

  await db
    .update(employees)
    .set({ ...next, updatedAt: now })
    .where(eq(employees.id, employee.id));

  await logAuditEvent({
    // The locked-out account is the subject, not the actor — nobody here chose to do this.
    actorEmployeeId: null,
    action: 'account_locked_out',
    resourceType: 'employee',
    resourceId: employee.id,
    result: 'success',
    metadata: {
      lockoutCount: next.lockoutCount,
      lockedUntil: next.lockedUntil.toISOString()
    }
  });

  const waiting = describeWait(minutesRemaining({ lockedUntil: next.lockedUntil }, now));
  const who = `${resolveDisplayName(employee)} (${employee.email})`;
  const repeat =
    next.lockoutCount > 1
      ? `\n\nThis is lockout number ${next.lockoutCount} for this account recently, which is why it lasts longer than the last one.`
      : '';

  const admins = await db
    .select({ id: employees.id, email: employees.email })
    .from(employees)
    .where(and(eq(employees.role, 'ADMIN'), eq(employees.status, 'active')));

  // Never allowed to fail the webhook: Clerk retries on a non-2xx, and a retry would write a
  // second lockout and escalate this account again for one real event.
  await Promise.allSettled(
    admins.map(async (admin) => {
      await createNotification({
        employeeId: admin.id,
        type: 'account_locked_out',
        title: 'An account was locked after failed sign-ins',
        body: `${who} was locked out after repeated failed sign-in attempts. They cannot sign in for ${waiting}.${repeat}`,
        link: '/dashboard/settings/access'
      });
      await sendEmail({
        to: admin.email,
        subject: 'SYRIX Forma — an account was locked after failed sign-ins',
        body: `${who} was locked out after repeated failed sign-in attempts.\n\nThey cannot sign in for ${waiting}.${repeat}\n\nIf this was not them, their password may be being guessed.\n\n${appUrl()}/dashboard/settings/access`
      });
    })
  );

  return next;
}
