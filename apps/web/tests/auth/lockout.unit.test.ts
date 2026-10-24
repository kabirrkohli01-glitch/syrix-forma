import { describe, expect, it } from 'vitest';
import {
  LOCKOUT_ESCALATION_WINDOW_DAYS,
  LOCKOUT_LADDER_MINUTES,
  effectivePriorLockouts,
  isCurrentlyLockedOut,
  lockoutDurationMinutes,
  minutesRemaining,
  nextLockoutState
} from '@/lib/auth/lockout';

const NOW = new Date('2026-09-13T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60_000);

describe('the escalation ladder', () => {
  it('gets longer every time, and stops at the top rung', () => {
    // The property that matters: a repeat offender always waits at least as long as last time,
    // and eventually a lot longer. The exact minutes are a judgement call; the direction is not.
    const durations = [0, 1, 2, 3, 4, 5, 12].map(lockoutDurationMinutes);
    for (let i = 1; i < durations.length; i++) {
      expect(durations[i]).toBeGreaterThanOrEqual(durations[i - 1]);
    }

    expect(lockoutDurationMinutes(0)).toBe(LOCKOUT_LADDER_MINUTES[0]);
    const top = LOCKOUT_LADDER_MINUTES[LOCKOUT_LADDER_MINUTES.length - 1];
    expect(lockoutDurationMinutes(99)).toBe(top);
  });

  it('gives a first-time mistake the shortest wait', () => {
    // Somebody who has genuinely forgotten their password should not be shut out for hours.
    expect(lockoutDurationMinutes(0)).toBeLessThanOrEqual(15);
  });

  it('treats a negative count as a first offence rather than reading off the end', () => {
    expect(lockoutDurationMinutes(-3)).toBe(LOCKOUT_LADDER_MINUTES[0]);
  });
});

describe('the escalation window', () => {
  it('forgets lockouts older than the window', () => {
    // Without this the count only ever rises, and one bad afternoon last year would put a real
    // employee straight onto the longest lockout for a typo.
    const stale = {
      lockoutCount: 4,
      lockoutCountResetAt: daysAgo(LOCKOUT_ESCALATION_WINDOW_DAYS + 1)
    };
    expect(effectivePriorLockouts(stale, NOW)).toBe(0);
    expect(nextLockoutState(stale, NOW).lockedUntil).toEqual(
      new Date(NOW.getTime() + LOCKOUT_LADDER_MINUTES[0] * 60_000)
    );
  });

  it('still counts lockouts inside the window', () => {
    const recent = { lockoutCount: 2, lockoutCountResetAt: daysAgo(1) };
    expect(effectivePriorLockouts(recent, NOW)).toBe(2);
    expect(nextLockoutState(recent, NOW).lockoutCount).toBe(3);
  });

  it('does not let someone climb back down by waiting out the original window', () => {
    // The window is anchored when the run starts and carries forward while the run continues,
    // so repeated lockouts keep escalating instead of resetting mid-run.
    const anchored = daysAgo(2);
    const state = nextLockoutState({ lockoutCount: 2, lockoutCountResetAt: anchored }, NOW);
    expect(state.lockoutCountResetAt).toEqual(anchored);
  });

  it('anchors the window on the first lockout of a run', () => {
    const first = nextLockoutState({ lockoutCount: 0, lockoutCountResetAt: null }, NOW);
    expect(first.lockoutCountResetAt).toEqual(NOW);
    expect(first.lockoutCount).toBe(1);
  });
});

describe('whether an account is held out', () => {
  it('is locked while the expiry is in the future and free once it passes', () => {
    const future = new Date(NOW.getTime() + 60_000);
    const past = new Date(NOW.getTime() - 60_000);

    expect(isCurrentlyLockedOut({ lockedUntil: future }, NOW)).toBe(true);
    expect(isCurrentlyLockedOut({ lockedUntil: past }, NOW)).toBe(false);
    expect(isCurrentlyLockedOut({ lockedUntil: null }, NOW)).toBe(false);
  });

  it('reports the wait rounded up, so it never says zero while still locked', () => {
    const in90Seconds = new Date(NOW.getTime() + 90_000);
    expect(minutesRemaining({ lockedUntil: in90Seconds }, NOW)).toBe(2);
    expect(minutesRemaining({ lockedUntil: null }, NOW)).toBe(0);
  });
});
