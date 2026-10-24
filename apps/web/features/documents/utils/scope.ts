import { and, eq, exists, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  clientStaff,
  clients,
  documentFiles,
  projectStaff,
  projects,
  tasks
} from '@/lib/db/schema';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

/**
 * The WHERE clause equivalent of `lib/permissions/document-access.ts`, for the list query.
 *
 * A document is visible when the record it is attached to is visible, or — if it is attached to
 * nothing — when it belongs to the caller's team. Written as one OR of four branches rather than
 * fetched and filtered in JS, so pagination counts the rows the caller can actually see; a filter
 * applied after the limit returns short pages and eventually an empty one that is not empty.
 *
 * Kept next to the feature rather than in lib/permissions/ for the same reason every other
 * feature's scope.ts is: it composes that feature's own tables, and SYRIX AI's context broker
 * reuses these files precisely so there is never a second answer to "what can this person see".
 */
export function documentFileScopeCondition(caller: ActiveEmployee): SQL | undefined {
  const scope = scopeForBusinessData(caller.role);

  if (scope === 'all' || scope === 'cross-team') return undefined;
  if (scope === 'none') return sql`false`;

  const staffedOnClient = exists(
    db
      .select({ id: clientStaff.id })
      .from(clientStaff)
      .where(
        and(
          eq(clientStaff.clientId, documentFiles.clientId),
          eq(clientStaff.employeeId, caller.id)
        )
      )
  );

  const staffedOnProject = exists(
    db
      .select({ id: projectStaff.id })
      .from(projectStaff)
      .where(
        and(
          eq(projectStaff.projectId, documentFiles.projectId),
          eq(projectStaff.employeeId, caller.id)
        )
      )
  );

  const onVisibleClient = exists(
    db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.id, documentFiles.clientId),
          caller.team ? or(eq(clients.team, caller.team), staffedOnClient) : staffedOnClient
        )
      )
  );

  const onVisibleProject = exists(
    db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, documentFiles.projectId),
          caller.team ? or(eq(projects.team, caller.team), staffedOnProject) : staffedOnProject
        )
      )
  );

  const onVisibleTask = exists(
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, documentFiles.taskId),
          caller.team
            ? or(eq(tasks.team, caller.team), eq(tasks.assigneeId, caller.id))
            : eq(tasks.assigneeId, caller.id)
        )
      )
  );

  // Unattached: team property, or the caller's own upload when they are on no team.
  const unattached = and(
    isNull(documentFiles.clientId),
    isNull(documentFiles.projectId),
    isNull(documentFiles.taskId),
    caller.team
      ? or(
          eq(documentFiles.team, caller.team),
          eq(documentFiles.uploadedByEmployeeId, caller.id)
        )
      : eq(documentFiles.uploadedByEmployeeId, caller.id)
  );

  return or(
    unattached,
    and(isNotNull(documentFiles.clientId), onVisibleClient),
    and(isNotNull(documentFiles.projectId), onVisibleProject),
    and(isNotNull(documentFiles.taskId), onVisibleTask)
  );
}
