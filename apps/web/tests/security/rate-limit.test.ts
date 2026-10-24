import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Exercises the in-process path, which is what runs when REDIS_URL is unset — a local Hub, and
 * any deployment that has not configured Redis. The Redis path is the same arithmetic performed
 * by the server, and standing up a Redis instance to assert that INCR counts would be testing
 * Redis rather than this.
 */

describe('the fixed-window limiter', () => {
  beforeEach(() => {
    vi.stubEnv('REDIS_URL', '');
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('allows up to the limit and refuses the one after it', async () => {
    const { checkRateLimit } = await import('@/lib/security/rate-limit');
    const key = `test-${Math.random()}`;

    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit(key, 3, 60)).allowed).toBe(true);
    }

    const refused = await checkRateLimit(key, 3, 60);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each requester separately', async () => {
    const { checkRateLimit } = await import('@/lib/security/rate-limit');
    const suffix = Math.random();

    await checkRateLimit(`a-${suffix}`, 1, 60);
    expect((await checkRateLimit(`a-${suffix}`, 1, 60)).allowed).toBe(false);
    // One employee exhausting their budget must never affect another's.
    expect((await checkRateLimit(`b-${suffix}`, 1, 60)).allowed).toBe(true);
  });

  it('lets the window lapse rather than locking someone out for ever', async () => {
    vi.useFakeTimers();
    const { checkRateLimit } = await import('@/lib/security/rate-limit');
    const key = `lapse-${Math.random()}`;

    await checkRateLimit(key, 1, 60);
    expect((await checkRateLimit(key, 1, 60)).allowed).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect((await checkRateLimit(key, 1, 60)).allowed).toBe(true);
  });

  it('does not extend the window when requests keep arriving', async () => {
    vi.useFakeTimers();
    const { checkRateLimit } = await import('@/lib/security/rate-limit');
    const key = `fixed-${Math.random()}`;

    await checkRateLimit(key, 1, 60);
    // A sliding window that reset on every hit would never let this requester back in.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(10_000);
      await checkRateLimit(key, 1, 60);
    }
    vi.advanceTimersByTime(11_000);
    expect((await checkRateLimit(key, 1, 60)).allowed).toBe(true);
  });
});
