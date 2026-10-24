/**
 * A shared access code in place of individual sign-in, for a demonstration deployment.
 *
 * This exists so the Hub can be shown to people over the internet before it has the one thing a
 * real sign-in needs and does not yet have: a Clerk production instance, which requires CNAME
 * records on a domain the operator controls. Rather than expose a Clerk *development* instance —
 * which accepts sign-up from any origin, so anybody who finds the URL can create an account and
 * land inside the Hub — the whole identity provider is taken out of the request path and replaced
 * by one code that opens one fixed, already-approved account.
 *
 * What that trades away, stated plainly because a deployment running this is not secure in the
 * way the rest of the codebase is:
 *
 *   - There is no "who did this". Every session is the same employee, so the audit log, the
 *     approval cards and every `createdBy` record the same person no matter who is at the
 *     keyboard. Accountability is gone, not weakened.
 *   - A code that several people know is a credential that cannot be revoked from one of them.
 *   - Anybody holding the code holds whatever that account holds, including administration.
 *
 * It is therefore off unless ACCESS_CODE_MODE is set to exactly 'on' — no default, no inference
 * from any other variable — and lib/config/preflight.ts refuses to boot a deployment that
 * half-configures it. The account it opens should be one whose data the operator is willing to
 * show to whoever is given the code.
 *
 * The code itself is checked in constant time and rate-limited to a handful of attempts before a
 * lockout (lib/auth/access-code-lockout.ts) — a four-digit code is 10,000 possibilities, which is
 * nothing at all to a script and a great deal to a person typing.
 *
 * This module holds only the questions that can be answered from configuration, so that anything
 * — including code Next.js traces into an Edge bundle — can ask whether the mode is on without
 * pulling node:crypto in behind it. The signing lives in access-code.ts, which re-exports
 * everything here so a caller needing both has one import.
 */

/** Session cookie: no Max-Age, so closing the browser ends the session and the code is asked for
 *  again the next time the Hub is opened. The expiry inside the value is the server-side half —
 *  a cookie's own lifetime is a request from the server that the browser is free to ignore. */
export const ACCESS_COOKIE_NAME = 'forma_access';

export const ACCESS_CODE_PATH = '/access-code';

export type AccessCodeConfig = {
  code: string;
  /** The employees row this session becomes, looked up by email. */
  identityEmail: string;
  /** How long one unlocked session lasts before the code is asked for again. */
  sessionMinutes: number;
  /** Wrong answers allowed before the lockout. */
  maxAttempts: number;
  lockoutMinutes: number;
};

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** True when this deployment is configured to ask for a code instead of a sign-in. */
export function accessCodeModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ACCESS_CODE_MODE === 'on';
}

/**
 * The configuration, or null when the mode is off.
 *
 * Returns null rather than throwing on an incomplete configuration, so that a missing value can
 * never be the thing that takes a page down mid-render. preflight.ts is what turns the same
 * condition into a refusal to boot, once, at startup, with a message saying which value is wrong.
 */
export function accessCodeConfig(env: NodeJS.ProcessEnv = process.env): AccessCodeConfig | null {
  if (!accessCodeModeEnabled(env)) return null;

  const code = env.ACCESS_CODE?.trim();
  const identityEmail = env.ACCESS_CODE_IDENTITY?.trim().toLowerCase();
  if (!code || !identityEmail) return null;

  return {
    code,
    identityEmail,
    sessionMinutes: positiveInt(env.ACCESS_CODE_SESSION_MINUTES, 12 * 60),
    maxAttempts: positiveInt(env.ACCESS_CODE_MAX_ATTEMPTS, 5),
    lockoutMinutes: positiveInt(env.ACCESS_CODE_LOCKOUT_MINUTES, 5)
  };
}

/** Digits only, and long enough to be worth rate-limiting. Used by preflight, not at request time. */
export function describeCodeProblem(code: string | undefined): string | null {
  if (!code) return 'not set';
  if (!/^\d{4,12}$/.test(code)) return 'must be between 4 and 12 digits';
  return null;
}
