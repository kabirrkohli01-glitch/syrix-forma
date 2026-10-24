import { eq, or, type SQL } from 'drizzle-orm';
import { employees } from './schema';

/**
 * "This row is an HR administrator", as a SQL condition.
 *
 * The counterpart to `isHrAdmin()` in `lib/permissions/hr-access.ts`, which answers the same
 * question about the caller. Both are needed because some code asks it of the person making the
 * request and some asks it of every row in the table — finding who a leave request should be
 * routed to, or who to notify about a reported incident.
 *
 * Keeping the two in one place each is the point. While HR administration was a role alone, a
 * query could get away with comparing the role column; now that it can also be a capability, a
 * query that still compares only the role silently routes approvals to nobody.
 */
export const isHrAdminRow: SQL = or(
  eq(employees.role, 'HR_ADMIN'),
  eq(employees.hrAdmin, true)
) as SQL;
