/**
 * Whether a thrown value is Postgres rejecting a duplicate (SQLSTATE 23505), optionally for one
 * named constraint.
 *
 * Needed because the driver's own message is `Failed query: insert into ...` with the SQL and the
 * parameters — the constraint name appears only on the underlying error, which Drizzle attaches
 * as `cause`. Matching on message text instead looks like it works and silently stops working, so
 * a "that name is taken" branch written that way quietly degrades to a generic internal-fault
 * message the first time the driver rewords itself.
 *
 * Used to turn a race-safe insert into a sentence: checking for an existing row and inserting
 * afterwards leaves a window in which another request inserts the same value, so the constraint
 * is the real check and this is how its result is read.
 */
export function isUniqueViolation(error: unknown, constraintName?: string): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === '23505') {
      return !constraintName || candidate.constraint_name === constraintName;
    }
    current = candidate.cause;
  }
  return false;
}
