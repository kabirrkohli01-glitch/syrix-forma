'use server';

import { count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { checklistItems, tasks } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { canEditTask } from '@/lib/permissions/task-access';
import {
  addChecklistItemSchema,
  updateChecklistItemSchema,
  type AddChecklistItemInput,
  type UpdateChecklistItemInput
} from './utils/schemas';

async function getEditableTaskOrThrow(taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error('Task not found');
  const caller = await requireActiveEmployee();
  if (!canEditTask(caller, { id: task.id, assigneeId: task.assigneeId, team: task.team })) {
    throw new Error('Not permitted to edit this task');
  }
  return { caller, task };
}

export async function addChecklistItem(taskId: string, input: AddChecklistItemInput) {
  const { caller } = await getEditableTaskOrThrow(taskId);
  const parsed = addChecklistItemSchema.parse(input);

  const [{ total }] = await db
    .select({ total: count() })
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId));

  const [created] = await db
    .insert(checklistItems)
    .values({ taskId, label: parsed.label, position: total })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'checklist_item_added',
    resourceType: 'task',
    resourceId: taskId,
    result: 'success',
    metadata: { checklistItemId: created.id }
  });

  revalidatePath('/dashboard/my-work');
  return created;
}

export async function updateChecklistItem(itemId: string, input: UpdateChecklistItemInput) {
  const [item] = await db.select().from(checklistItems).where(eq(checklistItems.id, itemId)).limit(1);
  if (!item) throw new Error('Checklist item not found');
  const { caller } = await getEditableTaskOrThrow(item.taskId);
  const parsed = updateChecklistItemSchema.parse(input);

  const [updated] = await db
    .update(checklistItems)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(checklistItems.id, itemId))
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'checklist_item_updated',
    resourceType: 'task',
    resourceId: item.taskId,
    result: 'success',
    metadata: { checklistItemId: itemId, fields: Object.keys(parsed) }
  });

  revalidatePath('/dashboard/my-work');
  return updated;
}

export async function removeChecklistItem(itemId: string) {
  const [item] = await db.select().from(checklistItems).where(eq(checklistItems.id, itemId)).limit(1);
  if (!item) throw new Error('Checklist item not found');
  const { caller } = await getEditableTaskOrThrow(item.taskId);

  await db.delete(checklistItems).where(eq(checklistItems.id, itemId));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'checklist_item_removed',
    resourceType: 'task',
    resourceId: item.taskId,
    result: 'success',
    metadata: { checklistItemId: itemId }
  });

  revalidatePath('/dashboard/my-work');
}
