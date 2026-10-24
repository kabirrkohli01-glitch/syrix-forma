/**
 * A fixed-window rate limit, keyed by whatever the caller decides identifies a requester.
 *
 * The Hub had none. Clerk rate-limits sign-in, and the MFA challenge locks an account after
 * repeated failures, but everything *after* authentication was unbounded — including the two
 * things that cost real resources per call: a SYRIX AI turn, which spends a model round trip and
 * several page fetches, and a connector test, which makes the server issue an outbound request
 * to an address the caller supplied. Neither is a route an attacker needs; a signed-in employee
 * holding the loop key down is enough to exhaust either.
 *
 * Backed by Redis when it is configured, so a limit holds across every instance of a deployed
 * Hub. Falls back to an in-process map otherwise — which is per-instance and therefore weaker,
 * and is the honest behaviour for a single-process local Hub rather than a claim of protection
 * that does not exist.
 */
import Redis from 'ioredis';

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the window resets. Only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
};

type Window = { count: number; resetAt: number };

const memory = new Map<string, Window>();

/** One shared client. Created lazily so importing this module never opens a connection. */
let redis: Redis | null | undefined;

function redisClient(): Redis | null {
  if (redis !== undefined) return redis;

  const url = process.env.REDIS_URL;
  if (!url) {
    redis = null;
    return redis;
  }

  redis = new Redis(url, {
    // A rate limit must never become the reason a request fails: if Redis is slow or away, the
    // check below catches the error and allows the request. Capping retries keeps that decision
    // fast rather than leaving the caller waiting on a dead socket.
    maxRetriesPerRequest: 1,
    lazyConnect: false,
    enableOfflineQueue: false
  });
  redis.on('error', () => {
    // Swallowed deliberately. An unhandled 'error' on an ioredis client crashes the process, and
    // a rate limiter losing its backing store is not worth taking the Hub down for — the call
    // sites below already treat a failure as "allow".
  });
  return redis;
}

function checkInMemory(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const existing = memory.get(key);

  if (!existing || existing.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });

    // Opportunistic sweep so a long-running process does not accumulate a key per requester for
    // ever. Cheap because it only runs when a window is created.
    if (memory.size > 10_000) {
      for (const [existingKey, window] of memory) {
        if (window.resetAt <= now) memory.delete(existingKey);
      }
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Records one hit against `key` and says whether it is within the limit.
 *
 * Fails open. A rate limiter that starts refusing work because its own store is unreachable has
 * turned a defence into an outage, and the thing it protects against is resource exhaustion
 * rather than unauthorised access — every route calling this has already authenticated and
 * authorised the caller by the time it gets here.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const client = redisClient();
  if (!client) return checkInMemory(key, limit, windowSeconds);

  try {
    const redisKey = `ratelimit:${key}`;
    // INCR then EXPIRE only on the first hit: the window starts when the first request in it
    // arrives and is not extended by later ones, which is what makes it a fixed window rather
    // than a sliding one that never resets under sustained load.
    const count = await client.incr(redisKey);
    if (count === 1) await client.expire(redisKey, windowSeconds);

    if (count > limit) {
      const ttl = await client.ttl(redisKey);
      return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch {
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Limits chosen to be invisible to a person working and obvious to a loop. */
export const RATE_LIMITS = {
  /** A SYRIX AI turn costs a model round trip and several page fetches. */
  aiTurn: { limit: 20, windowSeconds: 60 },
  /** A connector test makes the server fetch an address the caller supplied. */
  connectorTest: { limit: 10, windowSeconds: 60 },
  /** An upload request mints a pre-signed URL; cheap, but not free, and trivially loopable. */
  uploadRequest: { limit: 60, windowSeconds: 60 }
} as const;
