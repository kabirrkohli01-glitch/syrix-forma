/**
 * Errors whose message is safe to show the caller verbatim: a refusal, a missing record, a file
 * type that is not accepted. Anything else thrown is an internal fault — a storage failure, a
 * database error — and its message must not reach the UI, since it can carry infrastructure
 * detail and, for a storage error, parts of a signed URL.
 *
 * Same split as features/chat/utils/errors.ts and features/hr/utils/errors.ts. Its own module
 * because a `'use server'` file may only export async functions, so a class cannot live beside
 * the actions.
 */
export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentError';
  }
}

export function isDocumentError(error: unknown): error is DocumentError {
  return error instanceof DocumentError;
}

export function documentErrorMessage(error: unknown): string {
  if (isDocumentError(error)) return error.message;
  return 'Something went wrong. If it keeps happening, contact your administrator.';
}
