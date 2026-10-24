/**
 * Errors whose message is safe to show the caller verbatim: a permission refusal, a balance
 * that is too low, a record that no longer exists. Anything thrown that is *not* one of these
 * is an internal fault — a database failure, a storage error — and its message must never
 * reach the UI, since it can carry schema and infrastructure detail.
 *
 * Same split Team Chat introduced in features/chat/utils/errors.ts. Lives in its own module
 * rather than beside the actions because a `'use server'` file may only export async
 * functions, so a class cannot be declared there.
 */
export class HrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HrError';
  }
}

export function isHrError(error: unknown): error is HrError {
  return error instanceof HrError;
}

/**
 * Message to surface for an arbitrary thrown value. Deliberately generic for anything that is
 * not an HrError, regardless of the caller's role — unlike Team Chat's version, HR actions can
 * fail while handling special category data, and an error string is not the place to leak what
 * that data looked like.
 */
export function hrErrorMessage(error: unknown): string {
  if (isHrError(error)) return error.message;
  return 'Something went wrong. If it keeps happening, contact your administrator.';
}

// Re-exported so HR code keeps importing its error helpers from one place. The implementation is
// in lib/db/ because it is about the database driver rather than about HR.
export { isUniqueViolation } from '@/lib/db/unique-violation';
