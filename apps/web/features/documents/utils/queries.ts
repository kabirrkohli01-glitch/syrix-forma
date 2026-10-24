import { and, desc, eq, ilike, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employeeDisplayName } from '@/lib/db/display-name';
import {
  clients,
  documentFiles,
  documentLinks,
  employees,
  projects,
  tasks
} from '@/lib/db/schema';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import { clientScopeCondition } from '@/features/clients/utils/scope';
import { projectScopeCondition } from '@/features/projects/utils/scope';
import { taskScopeCondition } from '@/features/tasks/utils/scope';
import { documentFileScopeCondition } from './scope';

/** One row in the Documents list, whichever of the two kinds it came from. */
export type DocumentRow = {
  id: string;
  kind: 'file' | 'link';
  title: string;
  description: string | null;
  /** For a file: its original filename. For a link: the system it points at. */
  detail: string;
  sizeBytes: number | null;
  mimeType: string | null;
  url: string | null;
  linkStatus: 'unknown' | 'ok' | 'broken' | null;
  attachedTo: { kind: 'client' | 'project' | 'task'; id: string; name: string } | null;
  team: string | null;
  addedByName: string;
  addedByEmployeeId: string;
  createdAt: Date;
};

export type DocumentListFilters = {
  query?: string;
  /** 'all' shows both kinds — the default, because which kind a document is is rarely the question. */
  kind?: 'all' | 'file' | 'link';
};

/**
 * Everything the caller may see, newest first.
 *
 * Two queries rather than a SQL UNION: the two tables have genuinely different columns and
 * different visibility rules, and a union would need every column of each padded with nulls in
 * the other, producing a query nobody can read for a list that is small enough to merge in JS.
 * Each side is limited before the merge so one kind cannot crowd out the other.
 */
export async function listDocuments(
  caller: ActiveEmployee,
  filters: DocumentListFilters = {},
  limit = 100
): Promise<DocumentRow[]> {
  const kind = filters.kind ?? 'all';
  const search = filters.query?.trim();
  const pattern = search ? `%${search}%` : null;

  const filePromise: Promise<DocumentRow[]> =
    kind === 'link'
      ? Promise.resolve([])
      : db
          .select({
            id: documentFiles.id,
            title: documentFiles.title,
            description: documentFiles.description,
            fileName: documentFiles.fileName,
            mimeType: documentFiles.mimeType,
            sizeBytes: documentFiles.sizeBytes,
            team: documentFiles.team,
            clientId: documentFiles.clientId,
            clientName: clients.name,
            projectId: documentFiles.projectId,
            projectName: projects.name,
            taskId: documentFiles.taskId,
            taskTitle: tasks.title,
            addedByEmployeeId: documentFiles.uploadedByEmployeeId,
            addedByName: employeeDisplayName,
            createdAt: documentFiles.createdAt
          })
          .from(documentFiles)
          .innerJoin(employees, eq(employees.id, documentFiles.uploadedByEmployeeId))
          .leftJoin(clients, eq(clients.id, documentFiles.clientId))
          .leftJoin(projects, eq(projects.id, documentFiles.projectId))
          .leftJoin(tasks, eq(tasks.id, documentFiles.taskId))
          .where(
            and(
              isNull(documentFiles.archivedAt),
              documentFileScopeCondition(caller),
              pattern
                ? or(ilike(documentFiles.title, pattern), ilike(documentFiles.fileName, pattern))
                : undefined
            )
          )
          .orderBy(desc(documentFiles.createdAt))
          .limit(limit)
          .then((rows) =>
            rows.map((row): DocumentRow => ({
              id: row.id,
              kind: 'file',
              title: row.title,
              description: row.description,
              detail: row.fileName,
              sizeBytes: row.sizeBytes,
              mimeType: row.mimeType,
              url: null,
              linkStatus: null,
              attachedTo: attachmentOf(row),
              team: row.team,
              addedByName: row.addedByName,
              addedByEmployeeId: row.addedByEmployeeId,
              createdAt: row.createdAt
            }))
          );

  const linkPromise: Promise<DocumentRow[]> =
    kind === 'file'
      ? Promise.resolve([])
      : db
          .select({
            id: documentLinks.id,
            label: documentLinks.label,
            url: documentLinks.url,
            system: documentLinks.system,
            lastCheckStatus: documentLinks.lastCheckStatus,
            clientId: documentLinks.clientId,
            clientName: clients.name,
            projectId: documentLinks.projectId,
            projectName: projects.name,
            taskId: documentLinks.taskId,
            taskTitle: tasks.title,
            addedByEmployeeId: documentLinks.addedByEmployeeId,
            addedByName: employeeDisplayName,
            createdAt: documentLinks.createdAt
          })
          .from(documentLinks)
          .innerJoin(employees, eq(employees.id, documentLinks.addedByEmployeeId))
          .leftJoin(clients, eq(clients.id, documentLinks.clientId))
          .leftJoin(projects, eq(projects.id, documentLinks.projectId))
          .leftJoin(tasks, eq(tasks.id, documentLinks.taskId))
          .where(and(linkVisibility(caller), pattern ? ilike(documentLinks.label, pattern) : undefined))
          .orderBy(desc(documentLinks.createdAt))
          .limit(limit)
          .then((rows) =>
            rows.map((row): DocumentRow => ({
              id: row.id,
              kind: 'link',
              title: row.label,
              description: null,
              detail: SYSTEM_LABELS[row.system] ?? row.system,
              sizeBytes: null,
              mimeType: null,
              url: row.url,
              linkStatus: row.lastCheckStatus,
              attachedTo: attachmentOf(row),
              team: null,
              addedByName: row.addedByName,
              addedByEmployeeId: row.addedByEmployeeId,
              createdAt: row.createdAt
            }))
          );

  const [files, links] = await Promise.all([filePromise, linkPromise]);
  return [...files, ...links]
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

const SYSTEM_LABELS: Record<string, string> = {
  sharepoint: 'SharePoint',
  onedrive: 'OneDrive',
  nas: 'NAS',
  other: 'External link'
};

function attachmentOf(row: {
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskTitle: string | null;
}): DocumentRow['attachedTo'] {
  if (row.clientId && row.clientName) {
    return { kind: 'client', id: row.clientId, name: row.clientName };
  }
  if (row.projectId && row.projectName) {
    return { kind: 'project', id: row.projectId, name: row.projectName };
  }
  if (row.taskId && row.taskTitle) {
    return { kind: 'task', id: row.taskId, name: row.taskTitle };
  }
  return null;
}

/**
 * A link is visible exactly when its parent is.
 *
 * Unlike `documentFiles`, a link always has a parent — the table has existed since Phase 4 with
 * that rule enforced in its schema — so there is no unattached branch here. Each side reuses that
 * feature's own scope condition rather than restating it, which is what keeps the Documents page
 * from becoming a second, divergent answer to who can see a client.
 */
function linkVisibility(caller: ActiveEmployee): SQL | undefined {
  const clientCondition = clientScopeCondition(caller);
  const projectCondition = projectScopeCondition(caller);
  const taskCondition = taskScopeCondition(caller);

  // undefined from all three means an unrestricted role; nothing to add.
  if (!clientCondition && !projectCondition && !taskCondition) return undefined;

  // Each branch tests the parent columns of the already-joined row, so the scope conditions —
  // which are written against `clients`, `projects` and `tasks` — apply to the right one. The
  // joins are LEFT, so for a project-attached link the client branch sees a null client and
  // fails, which is what selects the single branch that applies.
  return or(
    and(isNotNull(documentLinks.clientId), clientCondition),
    and(isNotNull(documentLinks.projectId), projectCondition),
    and(isNotNull(documentLinks.taskId), taskCondition)
  );
}

/** Clients, projects and tasks the caller may attach a document to, for the upload dialog. */
export async function listAttachmentTargets(caller: ActiveEmployee) {
  const [clientRows, projectRows, taskRows] = await Promise.all([
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.status, 'active'), clientScopeCondition(caller)))
      .orderBy(clients.name)
      .limit(200),
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.status, 'active'), projectScopeCondition(caller)))
      .orderBy(projects.name)
      .limit(200),
    db
      .select({ id: tasks.id, name: tasks.title })
      .from(tasks)
      .where(and(isNull(tasks.archivedAt), taskScopeCondition(caller)))
      .orderBy(desc(tasks.updatedAt))
      .limit(200)
  ]);

  return { clients: clientRows, projects: projectRows, tasks: taskRows };
}
