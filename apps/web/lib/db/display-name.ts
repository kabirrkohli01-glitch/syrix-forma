import { sql } from 'drizzle-orm';
import { employees } from './schema';

/**
 * The name the Hub shows for a person, as a SQL expression.
 *
 * An employee's `name` is the account-of-record name that arrives from Clerk at
 * sign-up. `preferredName` is what they set for themselves in Settings. Every
 * screen that names a person reads THIS expression rather than the raw name
 * column, so a name set once in Settings is the name that appears in the sidebar,
 * on the team roster, next to a chat message, on a task assignment, throughout HR
 * and in search — not only in the dashboard greeting.
 *
 * Two rules this encodes and that must not drift apart:
 *
 * - It is display only. Permissions, the audit log and every join still key off
 *   `employees.id`, so renaming yourself can never move access or rewrite history.
 * - It never resolves to empty. A whitespace-only preferred name falls back to
 *   the account name, which is `notNull`, so no row can render as a blank person.
 *
 * Sorting and grouping use the same expression: a list ordered by one name while
 * displaying another looks unsorted to the person reading it.
 */
export const employeeDisplayName = sql<
  string
>`coalesce(nullif(btrim(${employees.preferredName}), ''), ${employees.name})`;

/** The same rule for a row already loaded in JS. Keep the two in step. */
export function resolveDisplayName(row: { name: string; preferredName?: string | null }): string {
  return row.preferredName?.trim() || row.name;
}
