'use server';

import {
  ACCESS_COOKIE_NAME,
  accessCodeConfig,
  accessSessionIsValid,
  codeMatches,
  mintAccessSession
} from '@/lib/auth/access-code';
import {
  accessCodeLockState,
  clearAccessCodeFailures,
  recordAccessCodeFailure
} from '@/lib/auth/access-code-lockout';
import { DEVICE_COOKIE_NAME, readSignedDeviceId } from '@/lib/auth/device-cookie';
import { cookies, headers } from 'next/headers';

export type AccessCodeResult =
  | { status: 'ok' }
  | { status: 'wrong' }
  | { status: 'locked'; retryAfterSeconds: number }
  | { status: 'unavailable' };

/**
 * What counts as "the same requester" for the purpose of the lockout.
 *
 * The device cookie first, because it is stable across a phone moving between networks and is
 * signed, so it cannot be set to somebody else's value to lock them out. Address second, for a
 * client that arrives without one. A requester who clears cookies gets a new bucket — which is
 * true of any per-browser counter and is why the code is also short-lived and the deployment
 * temporary, rather than this being presented as protection it is not.
 */
async function requesterKey(): Promise<string> {
  const cookieStore = await cookies();
  const deviceId = readSignedDeviceId(cookieStore.get(DEVICE_COOKIE_NAME)?.value);
  if (deviceId) return `device:${deviceId}`;

  const headerList = await headers();
  const address =
    headerList.get('cf-connecting-ip') ??
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    'unknown';
  return `ip:${address}`;
}

/**
 * Checks the submitted code and, if it is right, opens a session.
 *
 * The lock is checked before the code is compared, so attempts made while locked out never reach
 * the comparison and cannot be used to keep probing at a slower rate.
 */
export async function submitAccessCode(submitted: string): Promise<AccessCodeResult> {
  const config = accessCodeConfig();
  if (!config) return { status: 'unavailable' };

  const key = await requesterKey();

  const lock = await accessCodeLockState(key, config);
  if (lock.lockedUntil) return { status: 'locked', retryAfterSeconds: lock.retryAfterSeconds };

  if (!codeMatches(submitted, config)) {
    const afterFailure = await recordAccessCodeFailure(key, config);
    if (afterFailure.lockedUntil) {
      return { status: 'locked', retryAfterSeconds: afterFailure.retryAfterSeconds };
    }
    return { status: 'wrong' };
  }

  await clearAccessCodeFailures(key);

  const cookieStore = await cookies();
  cookieStore.set(ACCESS_COOKIE_NAME, mintAccessSession(config), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
    // No maxAge on purpose: a session cookie, so closing the browser ends the session and the
    // Hub asks for the code again next time it is opened. The signed value carries its own
    // expiry for the case of a browser that is never closed.
  });

  return { status: 'ok' };
}

/** Ends the current session and sends the visitor back to the code screen. */
export async function clearAccessSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_COOKIE_NAME);
}

/** Whether the caller already holds a valid session — so the code screen can skip itself. */
export async function hasAccessSession(): Promise<boolean> {
  const cookieStore = await cookies();
  return accessSessionIsValid(cookieStore.get(ACCESS_COOKIE_NAME)?.value);
}

/** How long a locked-out requester has left, for the code screen to render on arrival. */
export async function currentLockSeconds(): Promise<number> {
  const config = accessCodeConfig();
  if (!config) return 0;
  const lock = await accessCodeLockState(await requesterKey(), config);
  return lock.retryAfterSeconds;
}
