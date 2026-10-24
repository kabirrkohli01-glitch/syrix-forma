import { and, eq, exists, or, sql, type SQL } from 'drizzle-orm';
import { clientStaff, clients } from '@/lib/db/schema';
import { db } from '@/lib/db/client';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

// Drizzle WHERE-clause equivalent of client-access.ts's canViewClient, for list queries that
// need to filter at the DB level. Unlike Task's scope condition, 'own' here is a real EXISTS
// subquery against client_staff — Client has no assignee column to compare against directly.
export function clientScopeCondition(caller: ActiveEmployee): SQL | undefined {
  const scope = scopeForBusinessData(caller.role);

  if (scope === 'all' || scope === 'cross-team') return undefined;
  if (scope === 'none') return sql`false`;

  const staffedCondition = exists(
    db
      .select({ id: clientStaff.id })
      .from(clientStaff)
      .where(and(eq(clientStaff.clientId, clients.id), eq(clientStaff.employeeId, caller.id)))
  );

  if (scope === 'own') return staffedCondition;

  // 'team' — same-team clients, plus anything the caller is personally staffed on even if
  // (unusually) tagged a different team, matching canViewClient's own-staffed check.
  return caller.team ? or(eq(clients.team, caller.team), staffedCondition) : staffedCondition;
}
