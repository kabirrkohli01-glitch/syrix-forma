/**
 * Locking an account out after repeated failed sign-ins, for longer each time.
 *
 * Clerk locks an account itself after a configured number of failed password attempts, but its
 * cooldown is a fixed length: the tenth lockout ends as quickly as the first, so an attacker
 * pays the same price however many times they come back. This adds the part that makes repeat
 * attempts expensive, and it is enforced in the Hub's own gate rather than at the identity
 * provider — Clerk's cooldown expires on its own schedule, and a sign-in that succeeds after it
 * must still meet this.
 *
 * It is not a replacement for Clerk's lockout and does not try to be. Clerk stops the guessing;
 * this decides how long the door stays shut afterwards.
 */

/**
 * How long the nth lockout lasts. Steep on purpose: someone who has genuinely forgotten their
 * password gets a quarter of an hour and a reset link, and is very unlikely to reach the third
 * step. Somebody working through a password list reaches the end of this quickly.
 */
export const LOCKOUT_LADDER_MINUTES = [15, 60, 6 * 60, 24 * 60, 7 * 24 * 60] as const;

/**
 * Lockouts older than this stop counting towards the ladder.
 *
 * Without a window the count only ever rises, so one bad week two years ago would put a real
 * employee straight onto a seven-day lockout for a typo. The window is what makes this a measure
 * of current suspicion rather than a permanent record.
 */
export const LOCKOUT_ESCALATION_WINDOW_DAYS = 30;

/** The duration to apply given how many lockouts are already on record inside the window. */
export function lockoutDurationMinutes(priorLockoutsInWindow: number): number {
  const index = Math.min(Math.max(priorLockoutsInWindow, 0), LOCKOUT_LADDER_MINUTES.length - 1);
  return LOCKOUT_LADDER_MINUTES[index];
}

/** When a lockout starting now should end. */
export function lockoutExpiryFrom(priorLockoutsInWindow: number, now = new Date()): Date {
  return new Date(now.getTime() + lockoutDurationMinutes(priorLockoutsInWindow) * 60_000);
}

/**
 * Whether this account is currently held out.
 *
 * Takes the row rather than an id so it can be called from the dashboard layout, which has
 * already loaded the employee — a gate that costs a second query runs on every request.
 */
export function isCurrentlyLockedOut(
  employee: { lockedUntil: Date | null },
  now = new Date()
): boolean {
  return !!employee.lockedUntil && employee.lockedUntil.getTime() > now.getTime();
}

/** How much longer, in whole minutes, rounded up. For telling the person at the door. */
export function minutesRemaining(
  employee: { lockedUntil: Date | null },
  now = new Date()
): number {
  if (!isCurrentlyLockedOut(employee, now)) return 0;
  return Math.ceil((employee.lockedUntil!.getTime() - now.getTime()) / 60_000);
}

/**
 * The count to escalate from, given what is already on the row.
 *
 * Separated from the write below so the ladder can be tested without a database. Returns zero
 * once the window has passed, which is what stops the count rising for ever.
 */
export function effectivePriorLockouts(
  employee: { lockoutCount: number; lockoutCountResetAt: Date | null },
  now = new Date()
): number {
  if (!employee.lockoutCountResetAt) return employee.lockoutCount;

  const windowEnds =
    employee.lockoutCountResetAt.getTime() + LOCKOUT_ESCALATION_WINDOW_DAYS * 24 * 60 * 60_000;
  return windowEnds > now.getTime() ? employee.lockoutCount : 0;
}

/** What a lockout starting now should write to the row. */
export function nextLockoutState(
  employee: { lockoutCount: number; lockoutCountResetAt: Date | null },
  now = new Date()
): { lockedUntil: Date; lockoutCount: number; lockoutCountResetAt: Date } {
  const prior = effectivePriorLockouts(employee, now);

  return {
    lockedUntil: lockoutExpiryFrom(prior, now),
    lockoutCount: prior + 1,
    // A window that restarts on each lockout, so someone who keeps triggering them keeps
    // climbing rather than being let back to the bottom rung by waiting out the original window.
    lockoutCountResetAt: prior === 0 ? now : (employee.lockoutCountResetAt ?? now)
  };
}
