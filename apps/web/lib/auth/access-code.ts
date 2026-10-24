/**
 * The signed half of access-code mode: comparing the code, and minting and checking the cookie
 * that says it was answered.
 *
 * Split from access-code-config.ts because this file imports node:crypto. Next.js compiles
 * instrumentation.ts for the Edge runtime as well as for Node, so anything preflight reaches
 * gets traced into an Edge bundle — and a Node built-in in that bundle is a build warning on
 * every build, about a runtime this application never uses. The configuration questions
 * ("is the mode on", "is the code well formed") need no crypto, so they live where anything can
 * ask them; the signing lives here, where only the Node runtime imports it.
 *
 * See access-code-config.ts for what this mode is and what it gives up.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AccessCodeConfig } from './access-code-config';
import { deriveKey } from './mfa-keys';

const HMAC_KEY_INFO = 'syrix-forma:access-code-session:hmac-sha256';

export * from './access-code-config';

function sign(payload: string): string {
  return createHmac('sha256', deriveKey(HMAC_KEY_INFO)).update(payload).digest('base64url');
}

/**
 * Whether a submitted code matches, compared in constant time.
 *
 * A plain `===` on a secret leaks its prefix through how long the comparison takes. That is a
 * marginal attack over the internet and a free defence, and the rest of this codebase already
 * compares secrets this way (lib/auth/device-cookie.ts).
 */
export function codeMatches(submitted: string, config: AccessCodeConfig): boolean {
  const expected = Buffer.from(config.code);
  const actual = Buffer.from(submitted.trim());

  // Length is not secret — it is visible in the input box — but timingSafeEqual throws on a
  // length mismatch, so it has to be checked first either way.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** A signed cookie value for a session that has just answered the code correctly. */
export function mintAccessSession(config: AccessCodeConfig, now = Date.now()): string {
  const expiresAt = now + config.sessionMinutes * 60_000;
  const nonce = randomBytes(12).toString('base64url');
  const payload = `${expiresAt}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Whether a cookie value is a session this server issued and that has not expired.
 *
 * Anything malformed, unsigned or out of date is simply "no" — there is no partial credit and no
 * distinction reported to the caller, because every one of them means the same thing: ask for the
 * code again.
 */
export function accessSessionIsValid(
  cookieValue: string | undefined,
  now = Date.now()
): boolean {
  if (!cookieValue) return false;

  const [expiresAtRaw, nonce, signature] = cookieValue.split('.');
  if (!expiresAtRaw || !nonce || !signature) return false;

  const expected = Buffer.from(sign(`${expiresAtRaw}.${nonce}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  if (!timingSafeEqual(expected, actual)) return false;

  const expiresAt = Number(expiresAtRaw);
  return Number.isFinite(expiresAt) && expiresAt > now;
}
