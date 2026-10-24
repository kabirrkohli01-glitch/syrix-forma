'use server';

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import {
  clientStaff,
  clients,
  documentFiles,
  projectStaff,
  projects,
  tasks
} from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee, type ActiveEmployee } from '@/lib/permissions/current-employee';
import { canEditClient } from '@/lib/permissions/client-access';
import {
  canAddTeamDocument,
  canArchiveDocument,
  canViewTeamDocument
} from '@/lib/permissions/document-access';
import { canEditProject } from '@/lib/permissions/project-access';
import { canEditTask } from '@/lib/permissions/task-access';
import { checkRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit';
import { getStorageAdapter } from '@/lib/storage';
import { DocumentError } from './utils/errors';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  requestDocumentUploadSchema,
  updateDocumentSchema,
  type RequestDocumentUploadInput,
  type UpdateDocumentInput
} from './utils/schemas';

/**
 * Where a document may be attached, and the team it inherits.
 *
 * A document attached to a client, project or task takes that record's team, not the uploader's.
 * Otherwise someone on team A attaching a file to team B's client would create a document
 * invisible to the very team whose record it belongs to.
 */
async function resolveAttachment(
  caller: ActiveEmployee,
  parsed: { clientId?: string; projectId?: string; taskId?: string; team?: string }
): Promise<{ team: string; revalidate: string[] }> {
  if (parsed.clientId) {
    const [client] = await db.select().from(clients).where(eq(clients.id, parsed.clientId)).limit(1);
    if (!client) throw new DocumentError('That client is not available');
    const [staffRow] = await db
      .select({ id: clientStaff.id })
      .from(clientStaff)
      .where(and(eq(clientStaff.clientId, client.id), eq(clientStaff.employeeId, caller.id)))
      .limit(1);
    if (!canEditClient(caller, { id: client.id, team: client.team }, Boolean(staffRow))) {
      throw new DocumentError('You cannot add documents to that client');
    }
    return { team: client.team, revalidate: [`/dashboard/clients/${client.id}`] };
  }

  if (parsed.projectId) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, parsed.projectId))
      .limit(1);
    if (!project) throw new DocumentError('That project is not available');
    const [staffRow] = await db
      .select({ id: projectStaff.id })
      .from(projectStaff)
      .where(and(eq(projectStaff.projectId, project.id), eq(projectStaff.employeeId, caller.id)))
      .limit(1);
    if (!canEditProject(caller, { id: project.id, team: project.team }, Boolean(staffRow))) {
      throw new DocumentError('You cannot add documents to that project');
    }
    return { team: project.team, revalidate: [`/dashboard/projects/${project.id}`] };
  }

  if (parsed.taskId) {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, parsed.taskId)).limit(1);
    if (!task) throw new DocumentError('That task is not available');
    if (!canEditTask(caller, { id: task.id, assigneeId: task.assigneeId, team: task.team })) {
      throw new DocumentError('You cannot add documents to that task');
    }
    return { team: task.team, revalidate: [`/dashboard/my-work/${task.id}`] };
  }

  // Unattached. A caller on no team cannot be given one by typing it, which would be a way to
  // put a document into a team they are not in.
  const team = parsed.team?.trim() || caller.team;
  if (!team) {
    throw new DocumentError(
      'You are not on a team yet, so there is nowhere to file a document that is not attached to a client, project or task. Attach it to one, or ask an administrator to put you on a team.'
    );
  }
  if (!canAddTeamDocument(caller, team)) {
    throw new DocumentError('You cannot add documents to that team');
  }
  return { team, revalidate: [] };
}

/**
 * Creates the metadata row and returns a pre-signed URL the browser uploads the bytes to.
 *
 * Two steps, the same shape Team Chat attachments and HR documents use: the file never passes
 * through this server, so a 25 MB upload is not 25 MB of server memory and a Server Action body
 * limit is not the ceiling on document size.
 *
 * The row exists before the bytes do. A row whose upload never completes is a document that
 * fails to download rather than a document that silently is not there — visible, and cleanable,
 * which the reverse order is not.
 */
export async function requestDocumentUpload(input: RequestDocumentUploadInput) {
  const caller = await requireActiveEmployee();
  const parsed = requestDocumentUploadSchema.parse(input);

  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(parsed.mimeType)) {
    throw new DocumentError(
      'That file type is not accepted here. Link to it where it already lives instead.'
    );
  }

  // Each call writes a row and mints a pre-signed URL. Neither is expensive on its own, but the
  // pair is trivially loopable from a signed-in session and would leave a trail of rows pointing
  // at objects that were never uploaded.
  const limit = await checkRateLimit(
    `document-upload:${caller.id}`,
    RATE_LIMITS.uploadRequest.limit,
    RATE_LIMITS.uploadRequest.windowSeconds
  );
  if (!limit.allowed) {
    throw new DocumentError(
      `That is a lot of uploads at once. Try again in ${limit.retryAfterSeconds} seconds.`
    );
  }

  const { team, revalidate } = await resolveAttachment(caller, parsed);

  // Random key, never the filename: a user-supplied name in a storage path is a traversal and
  // collision risk, and the real name is kept on the row for display and download.
  const storageKey = `documents/${randomUUID()}`;

  const [created] = await db
    .insert(documentFiles)
    .values({
      title: parsed.title,
      description: parsed.description ?? null,
      storageKey,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
      team,
      clientId: parsed.clientId ?? null,
      projectId: parsed.projectId ?? null,
      taskId: parsed.taskId ?? null,
      uploadedByEmployeeId: caller.id
    })
    .returning({ id: documentFiles.id });

  const target = await getStorageAdapter().createUploadUrl(storageKey, parsed.mimeType);

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'document_uploaded',
    resourceType: 'document_file',
    resourceId: created.id,
    result: 'success',
    metadata: {
      team,
      clientId: parsed.clientId ?? null,
      projectId: parsed.projectId ?? null,
      taskId: parsed.taskId ?? null,
      sizeBytes: parsed.sizeBytes
    }
  });

  revalidatePath('/dashboard/documents');
  for (const path of revalidate) revalidatePath(path);

  return { documentId: created.id, upload: target };
}

/** A short-lived download URL, issued only after the caller's entitlement is re-checked. */
export async function getDocumentDownloadUrl(documentId: string) {
  const caller = await requireActiveEmployee();

  const [document] = await db
    .select()
    .from(documentFiles)
    .where(eq(documentFiles.id, documentId))
    .limit(1);
  if (!document || document.archivedAt) throw new DocumentError('That document is not available');

  if (!(await canReachDocument(caller, document))) {
    // The same message whether it does not exist or is not theirs — a distinct refusal would
    // confirm that a document with this id exists.
    throw new DocumentError('That document is not available');
  }

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'document_downloaded',
    resourceType: 'document_file',
    resourceId: document.id,
    result: 'success',
    metadata: { team: document.team }
  });

  return { url: await getStorageAdapter().createDownloadUrl(document.storageKey) };
}

export async function updateDocument(input: UpdateDocumentInput) {
  const caller = await requireActiveEmployee();
  const parsed = updateDocumentSchema.parse(input);

  const [document] = await db
    .select()
    .from(documentFiles)
    .where(eq(documentFiles.id, parsed.documentId))
    .limit(1);
  if (!document || document.archivedAt) throw new DocumentError('That document is not available');
  if (!(await canReachDocument(caller, document))) {
    throw new DocumentError('That document is not available');
  }

  await db
    .update(documentFiles)
    .set({
      title: parsed.title,
      description: parsed.description?.trim() || null,
      updatedAt: new Date()
    })
    .where(eq(documentFiles.id, document.id));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'document_updated',
    resourceType: 'document_file',
    resourceId: document.id,
    result: 'success',
    metadata: { title: parsed.title }
  });

  revalidatePath('/dashboard/documents');
}

export async function archiveDocument(documentId: string) {
  const caller = await requireActiveEmployee();

  const [document] = await db
    .select()
    .from(documentFiles)
    .where(eq(documentFiles.id, documentId))
    .limit(1);
  if (!document || document.archivedAt) throw new DocumentError('That document is not available');

  if (!(await canReachDocument(caller, document))) {
    throw new DocumentError('That document is not available');
  }
  if (!canArchiveDocument(caller, document)) {
    throw new DocumentError(
      'Only the person who uploaded it, or a team lead, can withdraw a document'
    );
  }

  await db
    .update(documentFiles)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(documentFiles.id, document.id));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'document_archived',
    resourceType: 'document_file',
    resourceId: document.id,
    result: 'success',
    metadata: { title: document.title, team: document.team }
  });

  revalidatePath('/dashboard/documents');
  if (document.clientId) revalidatePath(`/dashboard/clients/${document.clientId}`);
  if (document.projectId) revalidatePath(`/dashboard/projects/${document.projectId}`);
  if (document.taskId) revalidatePath(`/dashboard/my-work/${document.taskId}`);
}

/**
 * Whether one specific document is reachable by this caller.
 *
 * The list query answers the same question in SQL (`utils/scope.ts`), and this answers it for a
 * single row, because a download is reached by id rather than by appearing in a list — a
 * hand-crafted request must get the same answer as the interface (engineering rule 10).
 *
 * Attached documents defer to the parent's own predicate rather than to the copied team column,
 * so moving a client to another team moves its documents with it.
 */
async function canReachDocument(
  caller: ActiveEmployee,
  document: typeof documentFiles.$inferSelect
): Promise<boolean> {
  if (document.clientId) {
    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, document.clientId))
      .limit(1);
    if (!client) return false;
    const [staffRow] = await db
      .select({ id: clientStaff.id })
      .from(clientStaff)
      .where(and(eq(clientStaff.clientId, client.id), eq(clientStaff.employeeId, caller.id)))
      .limit(1);
    return canEditClient(caller, { id: client.id, team: client.team }, Boolean(staffRow));
  }

  if (document.projectId) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, document.projectId))
      .limit(1);
    if (!project) return false;
    const [staffRow] = await db
      .select({ id: projectStaff.id })
      .from(projectStaff)
      .where(and(eq(projectStaff.projectId, project.id), eq(projectStaff.employeeId, caller.id)))
      .limit(1);
    return canEditProject(caller, { id: project.id, team: project.team }, Boolean(staffRow));
  }

  if (document.taskId) {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, document.taskId)).limit(1);
    if (!task) return false;
    return canEditTask(caller, { id: task.id, assigneeId: task.assigneeId, team: task.team });
  }

  return canViewTeamDocument(caller, document);
}
