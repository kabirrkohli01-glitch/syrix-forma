import * as z from 'zod';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';

/** Throw this for anything safe to show verbatim to whoever triggered it — permission denials, "not found", bad input. */
export class ExpectedChatError extends Error {}

const GENERIC_MESSAGE = 'Something went wrong. Please contact your admin.';

/**
 * Every chat action's catch block funnels through here. A deliberately-thrown
 * ExpectedChatError (or a Zod validation error) is always safe to show as-is. Anything else —
 * a DB failure, a storage-provider error, a bug — is logged server-side (console.error; picked
 * up by Sentry once a real DSN exists, per DEPENDENCIES.md) and never shown verbatim to a normal
 * account: only ADMIN/SECURITY_ADMIN, who can actually act on it, sees the real message.
 */
export function throwSanitizedChatError(err: unknown, caller: Pick<ActiveEmployee, 'role'>): never {
  if (err instanceof ExpectedChatError) throw err;
  if (err instanceof z.ZodError) throw new Error(err.issues[0]?.message ?? 'Invalid input');

  console.error('[chat] unexpected error', err);

  if (caller.role === 'ADMIN' || caller.role === 'SECURITY_ADMIN') {
    throw err instanceof Error ? err : new Error(GENERIC_MESSAGE);
  }
  throw new Error(GENERIC_MESSAGE);
}
