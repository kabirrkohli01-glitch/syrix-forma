'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { clientStaff, clients, documentLinks, projectStaff, projects, tasks } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee, type ActiveEmployee } from '@/lib/permissions/current-employee';
import { canEditClient } from '@/lib/permissions/client-access';
import { canEditProject } from '@/lib/permissions/project-access';
import { canEditTask } from '@/lib/permissions/task-access';
import { addDocumentLinkSchema, type AddDocumentLinkInput } from './utils/schemas';

// A document link's own permission tier is exactly its parent client/project/task's edit access —
// there's no separate scope to invent here (see the table comment in lib/db/schema.ts).
async function assertCanEditParent(
  caller: ActiveEmployee,
  parent: { clientId?: string; projectId?: string; taskId?: string }
): Promise<{ revalidatePath: string }> {
  if (parent.clientId) {
    const [client] = await db.select().from(clients).where(eq(clients.id, parent.clientId)).limit(1);
    if (!client) throw new Error('Client not found');
    const [staffRow] = await db
      .select({ id: clientStaff.id })
      .from(clientStaff)
      .where(and(eq(clientStaff.clientId, client.id), eq(clientStaff.employeeId, caller.id)))
      .limit(1);
    if (!canEditClient(caller, { id: client.id, team: client.team }, !!staffRow)) {
      throw new Error('Not permitted to manage documents for this client');
    }
    return { revalidatePath: `/dashboard/clients/${client.id}` };
  }

  if (parent.projectId) {
    const [project] = await db.select().from(projects).where(eq(projects.id, parent.projectId)).limit(1);
    if (!project) throw new Error('Project not found');
    const [staffRow] = await db
      .select({ id: projectStaff.id })
      .from(projectStaff)
      .where(and(eq(projectStaff.projectId, project.id), eq(projectStaff.employeeId, caller.id)))
      .limit(1);
    if (!canEditProject(caller, { id: project.id, team: project.team }, !!staffRow)) {
      throw new Error('Not permitted to manage documents for this project');
    }
    return { revalidatePath: `/dashboard/projects/${project.id}` };
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, parent.taskId!)).limit(1);
  if (!task) throw new Error('Task not found');
  if (!canEditTask(caller, { id: task.id, assigneeId: task.assigneeId, team: task.team })) {
    throw new Error('Not permitted to manage attachments for this task');
  }
  return { revalidatePath: '/dashboard/my-work' };
}

export async function addDocumentLink(input: AddDocumentLinkInput) {
  const caller = await requireActiveEmployee();
  const parsed = addDocumentLinkSchema.parse(input);
  const { revalidatePath: path } = await assertCanEditParent(caller, parsed);

  const [created] = await db
    .insert(documentLinks)
    .values({
      label: parsed.label,
      url: parsed.url,
      system: parsed.system,
      clientId: parsed.clientId ?? null,
      projectId: parsed.projectId ?? null,
      taskId: parsed.taskId ?? null,
      addedByEmployeeId: caller.id
    })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'document_link_added',
    resourceType: 'document_link',
    resourceId: created.id,
    result: 'success',
    metadata: {
      system: parsed.system,
      clientId: parsed.clientId,
      projectId: parsed.projectId,
      taskId: parsed.taskId
    }
  });

  revalidatePath(path);
  return created;
}

export async function removeDocumentLink(id: string) {
  const caller = await requireActiveEmployee();

  const [link] = await db.select().from(documentLinks).where(eq(documentLinks.id, id)).limit(1);
  if (!link) throw new Error('Document link not found');

  const { revalidatePath: path } = await assertCanEditParent(caller, {
    clientId: link.clientId ?? undefined,
    projectId: link.projectId ?? undefined,
    taskId: link.taskId ?? undefined
  });

  await db.delete(documentLinks).where(eq(documentLinks.id, id));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'document_link_removed',
    resourceType: 'document_link',
    resourceId: id,
    result: 'success'
  });

  revalidatePath(path);
}
