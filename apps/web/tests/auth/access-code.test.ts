import { beforeEach, describe, expect, it } from 'vitest';
import {
  accessCodeConfig,
  accessCodeModeEnabled,
  accessSessionIsValid,
  codeMatches,
  describeCodeProblem,
  mintAccessSession,
  type AccessCodeConfig
} from '@/lib/auth/access-code';
import {
  accessCodeLockState,
  clearAccessCodeFailures,
  recordAccessCodeFailure,
  resetAccessCodeMemory
} from '@/lib/auth/access-code-lockout';
import { collectConfigProblems } from '@/lib/config/preflight';

// The session cookie is signed with a key derived from this, so it has to exist before any of the
// mint/verify tests run. Set on the real process env because deriveKey reads process.env directly.
process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
// No Redis in the test process: the lockout falls back to its in-process counter, which is the
// path worth testing here anyway — it is the one that has to hold when the store is unreachable.
delete process.env.REDIS_URL;

/** A process env with only the keys a case cares about. NODE_ENV is required by the type and is
 *  read by nothing in this module, so it is filled in rather than repeated at each call. */
function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { NODE_ENV: 'production', ...values } as NodeJS.ProcessEnv;
}

function config(overrides: Partial<AccessCodeConfig> = {}): AccessCodeConfig {
  return {
    code: '8576',
    identityEmail: 'owner@example.com',
    sessionMinutes: 60,
    maxAttempts: 5,
    lockoutMinutes: 5,
    ...overrides
  };
}

describe('access-code mode', () => {
  it('is off unless the flag says exactly "on"', () => {
    // Fails closed on anything ambiguous. A deployment that turned its sign-in off because a
    // variable said 'true' or 'ON' would be a deployment nobody meant to open with a code.
    for (const value of [undefined, '', 'off', 'true', 'ON', 'On', '1', 'yes']) {
      expect(accessCodeModeEnabled(env({ ACCESS_CODE_MODE: value }))).toBe(false);
    }
    expect(accessCodeModeEnabled(env({ ACCESS_CODE_MODE: 'on' }))).toBe(true);
  });

  it('reports no configuration when the mode is on but incomplete', () => {
    // Returning null rather than throwing is what keeps a missing value out of the render path;
    // preflight is where it becomes a refusal to boot.
    expect(accessCodeConfig(env({ ACCESS_CODE_MODE: 'on', ACCESS_CODE: '8576' }))).toBeNull();
    expect(
      accessCodeConfig(env({ ACCESS_CODE_MODE: 'on', ACCESS_CODE_IDENTITY: 'a@b.c' }))
    ).toBeNull();
  });

  it('lower-cases the identity so the lookup does not depend on how it was typed', () => {
    const resolved = accessCodeConfig(
      env({
        ACCESS_CODE_MODE: 'on',
        ACCESS_CODE: '8576',
        ACCESS_CODE_IDENTITY: 'Owner@Example.COM'
      })
    );
    expect(resolved?.identityEmail).toBe('owner@example.com');
  });

  it('falls back to sane limits rather than to none', () => {
    // A non-numeric or negative limit must not become "unlimited attempts" or "zero-length
    // lockout" — the two values whose failure mode is silent.
    const resolved = accessCodeConfig(
      env({
        ACCESS_CODE_MODE: 'on',
        ACCESS_CODE: '8576',
        ACCESS_CODE_IDENTITY: 'a@b.c',
        ACCESS_CODE_MAX_ATTEMPTS: 'lots',
        ACCESS_CODE_LOCKOUT_MINUTES: '-5'
      })
    );
    expect(resolved?.maxAttempts).toBe(5);
    expect(resolved?.lockoutMinutes).toBe(5);
  });
});

describe('the code itself', () => {
  it('matches only the exact code', () => {
    const cfg = config();
    expect(codeMatches('8576', cfg)).toBe(true);
    expect(codeMatches(' 8576 ', cfg)).toBe(true);
    for (const wrong of ['8577', '857', '85760', '', 'abcd']) {
      expect(codeMatches(wrong, cfg)).toBe(false);
    }
  });

  it('rejects a code that is not digits, or is too short to be worth locking out over', () => {
    expect(describeCodeProblem(undefined)).toMatch(/not set/);
    expect(describeCodeProblem('123')).toMatch(/4 and 12 digits/);
    expect(describeCodeProblem('letmein')).toMatch(/4 and 12 digits/);
    expect(describeCodeProblem('8576')).toBeNull();
  });
});

describe('the unlocked session', () => {
  it('accepts a cookie it minted and refuses one it did not', () => {
    const cookie = mintAccessSession(config());
    expect(accessSessionIsValid(cookie)).toBe(true);

    for (const forged of [
      undefined,
      '',
      'nonsense',
      // Right shape, wrong signature — the whole point of signing it.
      `${Date.now() + 60_000}.abc.notarealsignature`,
      // A real signature with the expiry edited, which is the attack signing exists to stop.
      cookie.replace(/^\d+/, String(Date.now() + 999_999_999))
    ]) {
      expect(accessSessionIsValid(forged)).toBe(false);
    }
  });

  it('expires', () => {
    const cookie = mintAccessSession(config({ sessionMinutes: 1 }));
    expect(accessSessionIsValid(cookie, Date.now() + 30_000)).toBe(true);
    expect(accessSessionIsValid(cookie, Date.now() + 61_000)).toBe(false);
  });
});

describe('the lockout', () => {
  beforeEach(() => {
    resetAccessCodeMemory();
  });

  it('locks on the configured number of wrong answers and not before', async () => {
    const cfg = config();
    const key = 'device:test';

    for (let attempt = 1; attempt < cfg.maxAttempts; attempt += 1) {
      const state = await recordAccessCodeFailure(key, cfg);
      expect(state.lockedUntil).toBeNull();
    }

    const locked = await recordAccessCodeFailure(key, cfg);
    expect(locked.lockedUntil).not.toBeNull();
    expect(locked.retryAfterSeconds).toBeGreaterThan(0);
    expect(locked.retryAfterSeconds).toBeLessThanOrEqual(cfg.lockoutMinutes * 60);
  });

  it('reports the lock without spending an attempt', async () => {
    const cfg = config({ maxAttempts: 2 });
    const key = 'device:test';

    // One failure short of the lock, then two reads: if reading counted, the second would lock.
    await recordAccessCodeFailure(key, cfg);
    expect((await accessCodeLockState(key, cfg)).lockedUntil).toBeNull();
    expect((await accessCodeLockState(key, cfg)).lockedUntil).toBeNull();
  });

  it('expires the lock', async () => {
    const cfg = config({ maxAttempts: 1, lockoutMinutes: 5 });
    const key = 'device:test';

    await recordAccessCodeFailure(key, cfg);
    expect((await accessCodeLockState(key, cfg)).lockedUntil).not.toBeNull();

    const afterTheLock = Date.now() + 6 * 60_000;
    expect((await accessCodeLockState(key, cfg, afterTheLock)).lockedUntil).toBeNull();
  });

  it('counts each requester separately', async () => {
    const cfg = config({ maxAttempts: 2 });

    await recordAccessCodeFailure('device:one', cfg);
    await recordAccessCodeFailure('device:one', cfg);

    expect((await accessCodeLockState('device:one', cfg)).lockedUntil).not.toBeNull();
    expect((await accessCodeLockState('device:two', cfg)).lockedUntil).toBeNull();
  });

  it('forgets failures once the code is answered correctly', async () => {
    const cfg = config({ maxAttempts: 3 });
    const key = 'device:test';

    await recordAccessCodeFailure(key, cfg);
    await recordAccessCodeFailure(key, cfg);
    await clearAccessCodeFailures(key);

    // If the count had survived, this single failure would be the third and would lock.
    expect((await recordAccessCodeFailure(key, cfg)).lockedUntil).toBeNull();
  });
});

describe('preflight for an access-code deployment', () => {
  function codeEnv(): NodeJS.ProcessEnv {
    return {
      NODE_ENV: 'production',
      APP_ENV: 'production',
      ACCESS_CODE_MODE: 'on',
      ACCESS_CODE: '8576',
      ACCESS_CODE_IDENTITY: 'owner@example.com',
      DATABASE_URL: 'postgresql://user:pass@host/db',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_abc',
      CLERK_SECRET_KEY: 'sk_test_abc',
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      NEXT_PUBLIC_APP_URL: 'https://hub.example.com',
      REDIS_URL: 'rediss://host'
    } as NodeJS.ProcessEnv;
  }

  it('accepts a complete one, development Clerk keys and all', () => {
    // The keys are permitted here because nothing reaches Clerk's sign-in: proxy.ts turns /auth
    // away in this mode whether or not a session exists.
    expect(collectConfigProblems(codeEnv())).toEqual([]);
  });

  it('refuses a code that is missing or malformed', () => {
    const missing = { ...codeEnv() };
    delete missing.ACCESS_CODE;
    expect(collectConfigProblems(missing).map((p) => p.variable)).toContain('ACCESS_CODE');

    const malformed = { ...codeEnv(), ACCESS_CODE: 'hunter2' };
    expect(collectConfigProblems(malformed).map((p) => p.detail)).toContain(
      'must be between 4 and 12 digits'
    );
  });

  it('refuses an identity that was not named', () => {
    const env = { ...codeEnv() };
    delete env.ACCESS_CODE_IDENTITY;
    expect(collectConfigProblems(env).map((p) => p.variable)).toContain('ACCESS_CODE_IDENTITY');
  });

  it('requires Redis, because a lockout that empties on restart is not a lockout', () => {
    const env = { ...codeEnv() };
    delete env.REDIS_URL;
    expect(collectConfigProblems(env).map((p) => p.variable)).toContain('REDIS_URL');
  });

  it('refuses a mail credential rather than leaving one set and unused', () => {
    const env = { ...codeEnv(), RESEND_API_KEY: 're_abc' };
    expect(collectConfigProblems(env).map((p) => p.variable)).toContain('RESEND_API_KEY');
  });

  it('does not ask an access-code deployment for the mail configuration it must not have', () => {
    // The plain production list requires both of these; this mode must not inherit that, or a
    // correctly configured deployment could never boot.
    expect(collectConfigProblems(codeEnv()).map((p) => p.variable)).not.toContain(
      'NOTIFICATIONS_FROM_EMAIL'
    );
  });
});
