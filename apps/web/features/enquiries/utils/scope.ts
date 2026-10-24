import { eq, sql, type SQL } from 'drizzle-orm';
import { enquiries } from '@/lib/db/schema';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

// Drizzle WHERE-clause equivalent of enquiry-access.ts's canViewEnquiry, for list queries.
// Callers must gate on scope !== 'none' before querying at all — the `sql\`false\`` branch
// below is a defensive fallback, not the real enforcement.
export function enquiryScopeCondition(caller: ActiveEmployee): SQL | undefined {
  const scope = scopeForBusinessData(caller.role);

  if (scope === 'all' || scope === 'cross-team') return undefined;
  if (scope === 'none') return sql`false`;
  // 'own' (EMPLOYEE) and 'team' (TEAM_LEAD) collapse to the same team comparison — see
  // canViewEnquiry's comment on why Enquiry has no separate "own" concept.
  return caller.team ? eq(enquiries.team, caller.team) : sql`false`;
}
