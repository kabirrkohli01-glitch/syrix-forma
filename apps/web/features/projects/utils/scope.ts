import { and, eq, exists, or, sql, type SQL } from 'drizzle-orm';
import { projectStaff, projects } from '@/lib/db/schema';
import { db } from '@/lib/db/client';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

// Drizzle WHERE-clause equivalent of project-access.ts's canViewProject — same shape as
// clients/utils/scope.ts's clientScopeCondition (an EXISTS subquery for 'own' scope, since
// Project has no assignee column either).
export function projectScopeCondition(caller: ActiveEmployee): SQL | undefined {
  const scope = scopeForBusinessData(caller.role);

  if (scope === 'all' || scope === 'cross-team') return undefined;
  if (scope === 'none') return sql`false`;

  const staffedCondition = exists(
    db
      .select({ id: projectStaff.id })
      .from(projectStaff)
      .where(and(eq(projectStaff.projectId, projects.id), eq(projectStaff.employeeId, caller.id)))
  );

  if (scope === 'own') return staffedCondition;

  return caller.team
    ? or(eq(projects.team, caller.team), staffedCondition)
    : staffedCondition;
}
