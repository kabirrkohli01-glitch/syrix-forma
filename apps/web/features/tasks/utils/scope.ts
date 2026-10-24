import { eq, or, sql, type SQL } from 'drizzle-orm';
import { tasks } from '@/lib/db/schema';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

// Drizzle WHERE-clause equivalent of task-access.ts's canViewTask, for list/dashboard queries
// that need to filter at the DB level rather than fetch everything and check row-by-row.
// Callers must gate on scope !== 'none' before querying at all (PageContainer's `access` prop
// does this for pages) — the `sql\`false\`` branch below is a defensive fallback, not the
// real enforcement.
export function taskScopeCondition(caller: ActiveEmployee): SQL | undefined {
  const scope = scopeForBusinessData(caller.role);

  if (scope === 'all' || scope === 'cross-team') return undefined;
  if (scope === 'none') return sql`false`;
  if (scope === 'own') return eq(tasks.assigneeId, caller.id);

  // 'team' — same-team tasks, plus anything assigned to the caller even if (unusually) tagged
  // a different team, matching canViewTask's own-assignee check taking priority.
  return caller.team
    ? or(eq(tasks.team, caller.team), eq(tasks.assigneeId, caller.id))
    : eq(tasks.assigneeId, caller.id);
}
