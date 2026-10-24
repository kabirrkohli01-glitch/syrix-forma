/**
 * Counting wrong answers to the access code, and shutting the door for a while.
 *
 * Deliberately separate from lib/security/rate-limit.ts, which fails *open*: if its Redis is
 * unreachable it allows the request, because every caller of it has already authenticated and the
 * thing it protects is resource exhaustion. Neither is true here. This is the only check standing
 * in front of the Hub in access-code mode, so it fails *closed* — an unreachable store falls back
 * to an in-process counter rather than to permission.
 *
 * The in-process counter is the honest limit of this design and worth stating: it is per instance
 * and it empties on restart. With Redis configured the lockout holds across both. Without it, a
 * deployment that restarts frequently gives an attacker a fresh budget each time — which is why
 * REDIS_URL is required alongside the code in production (lib/config/preflight.ts).
 */
import Redis from 'ioredis';
import type { AccessCodeConfig } from './access-code';

export type AttemptState = {
  /** Epoch milliseconds, or null when not locked. */
  lockedUntil: number | null;
  /** Whole seconds remaining, rounded up. Zero when not locked. */
  retryAfterSeconds: number;
};

type MemoryRecord = { failures: number; lockedUntil: number | null; expiresAt: number };

const memory = new Map<string, MemoryRecord>();

let redis: Redis | null | undefined;

function redisClient(): Redis | null {
  if (redis !== undefined) return redis;

  const url = process.env.REDIS_URL;
  if (!url) {
    redis = null;
    return redis;
  }

  redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: false,
    enableOfflineQueue: false
  });
  redis.on('error', () => {
    // An unhandled 'error' event on an ioredis client takes the process down. Every call below
    // already treats a store failure as "use the in-process counter instead".
  });
  return redis;
}

function unlocked(): AttemptState {
  return { lockedUntil: null, retryAfterSeconds: 0 };
}

function lockedFor(lockedUntil: number, now: number): AttemptState {
  return {
    lockedUntil,
    retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - now) / 1000))
  };
}

function readMemory(key: string, now: number): MemoryRecord | null {
  const record = memory.get(key);
  if (!record) return null;
  if (record.expiresAt <= now) {
    memory.delete(key);
    return null;
  }
  return record;
}

function sweepMemory(now: number): void {
  if (memory.size <= 5_000) return;
  for (const [key, record] of memory) {
    if (record.expiresAt <= now) memory.delete(key);
  }
}

/** Whether this requester is currently shut out, without counting an attempt against them. */
export async function accessCodeLockState(
  key: string,
  config: AccessCodeConfig,
  now = Date.now()
): Promise<AttemptState> {
  const client = redisClient();

  if (client) {
    try {
      const raw = await client.get(`accesscode:lock:${key}`);
      const lockedUntil = Number(raw);
      if (Number.isFinite(lockedUntil) && lockedUntil > now) return lockedFor(lockedUntil, now);
      return unlocked();
    } catch {
      // Fall through to the in-process record.
    }
  }

  const record = readMemory(key, now);
  if (record?.lockedUntil && record.lockedUntil > now) return lockedFor(record.lockedUntil, now);
  return unlocked();
}

/**
 * Records one wrong answer and reports whether that was the one that triggered the lockout.
 *
 * The failure window is the lockout duration itself: wrong answers spread further apart than that
 * do not accumulate. Without a window, a person who mistypes the code once a week would eventually
 * lock themselves out of a demonstration for no reason.
 */
export async function recordAccessCodeFailure(
  key: string,
  config: AccessCodeConfig,
  now = Date.now()
): Promise<AttemptState> {
  const windowSeconds = config.lockoutMinutes * 60;
  const client = redisClient();

  if (client) {
    try {
      const failuresKey = `accesscode:fails:${key}`;
      const failures = await client.incr(failuresKey);
      if (failures === 1) await client.expire(failuresKey, windowSeconds);

      if (failures >= config.maxAttempts) {
        const lockedUntil = now + config.lockoutMinutes * 60_000;
        await client.set(`accesscode:lock:${key}`, String(lockedUntil), 'EX', windowSeconds);
        // Cleared so the next lockout needs a full run of wrong answers of its own rather than
        // being triggered by a single one on top of the old count.
        await client.del(failuresKey);
        return lockedFor(lockedUntil, now);
      }
      return unlocked();
    } catch {
      // Fall through to the in-process counter.
    }
  }

  sweepMemory(now);
  const record = readMemory(key, now) ?? { failures: 0, lockedUntil: null, expiresAt: 0 };
  record.failures += 1;
  record.expiresAt = now + windowSeconds * 1000;

  if (record.failures >= config.maxAttempts) {
    record.lockedUntil = now + config.lockoutMinutes * 60_000;
    record.failures = 0;
    memory.set(key, record);
    return lockedFor(record.lockedUntil, now);
  }

  memory.set(key, record);
  return unlocked();
}

/** Called on a correct code, so a run of typos does not count towards a later lockout. */
export async function clearAccessCodeFailures(key: string): Promise<void> {
  const client = redisClient();
  if (client) {
    try {
      await client.del(`accesscode:fails:${key}`);
    } catch {
      // Nothing to do — a stale counter expires on its own, and the in-process copy is cleared
      // below regardless of whether Redis answered.
    }
  }
  memory.delete(key);
}

/** Test seam: drops the in-process counters between cases. */
export function resetAccessCodeMemory(): void {
  memory.clear();
}
