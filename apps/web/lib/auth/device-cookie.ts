/**
 * A stable, signed identifier for the browser a request came from.
 *
 * Used for one thing: deciding whether an account has been seen on this device before, so that a
 * sign-in from somewhere new can be reported to an administrator (lib/auth/sign-in-events.ts).
 *
 * It is not an authentication factor and must never be treated as one. Anyone can discard the
 * cookie, and doing so produces a *new* device rather than a trusted one — the failure mode of
 * tampering is an extra alert, never a skipped check. That is why nothing anywhere reads this to
 * decide access; only Clerk's session and the Hub's own employee row do that.
 *
 * The value is random and carries no account data, so it stays meaningless to anyone who reads
 * it off a stolen machine. It is signed anyway, because an unsigned identifier is one an attacker
 * can set to a victim's known value to make their own sign-in look familiar and suppress the
 * alert — which is the only thing this cookie is for.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { deriveKey } from './mfa-keys';

const HMAC_KEY_INFO = 'syrix-forma:device-id:hmac-sha256';
export const DEVICE_COOKIE_NAME = 'forma_device';

// Long-lived on purpose: a device that has to re-identify itself every few weeks would report
// every regular user as new, and an alert that fires constantly is one nobody reads.
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function sign(deviceId: string): string {
  return createHmac('sha256', deriveKey(HMAC_KEY_INFO)).update(deviceId).digest('base64url');
}

/** The device id carried by a cookie value, or null if it is absent, malformed or unsigned. */
export function readSignedDeviceId(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const [deviceId, signature] = cookieValue.split('.');
  if (!deviceId || !signature) return null;

  const expected = Buffer.from(sign(deviceId));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return null;
  return timingSafeEqual(expected, actual) ? deviceId : null;
}

/** A fresh random device id, signed and ready to be set as a cookie value. Called by proxy.ts. */
export function mintSignedDeviceCookie(): string {
  const deviceId = randomBytes(16).toString('base64url');
  return `${deviceId}.${sign(deviceId)}`;
}

/**
 * The device id for the current request, or null if there is no valid one.
 *
 * Null should not happen in practice — proxy.ts issues a cookie on any request that lacks one,
 * and sets it on the request as well as the response so the same request can already read it.
 * It stays possible (a client that refuses cookies, a path outside the proxy matcher), and the
 * callers treat it as "unknown device" rather than assuming.
 */
export async function currentDeviceId(): Promise<string | null> {
  const cookieStore = await cookies();
  return readSignedDeviceId(cookieStore.get(DEVICE_COOKIE_NAME)?.value);
}
