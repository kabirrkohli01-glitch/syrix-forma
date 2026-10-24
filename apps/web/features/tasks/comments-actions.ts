'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { taskComments, tasks } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { canViewTask } from '@/lib/permissions/task-access';
import {
  addTaskCommentSchema,
  updateTaskCommentSchema,
  type AddTaskCommentInput,
  type UpdateTaskCommentInput
} from './utils/schemas';

// Commenting/reading comments is gated at "can view this task" — the same bar as watching, not
// the stricter "can edit" bar checklist/dependency mutations use. Editing/removing a comment is
// gated separately, at "you wrote it" (below), not at task-edit permission.
async function getViewableTaskOrThrow(taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error('Task not found');
  const caller = await requireActiveEmployee();
  if (!canViewTask(caller, { id: task.id, assigneeId: task.assigneeId, team: task.team })) {
    throw new Error('Not permitted to view this task');
  }
  return caller;
}

export async function addTaskComment(taskId: string, input: AddTaskCommentInput) {
  const caller = await getViewableTaskOrThrow(taskId);
  const parsed = addTaskCommentSchema.parse(input);

  const [created] = await db
    .insert(taskComments)
    .values({ taskId, authorEmployeeId: caller.id, body: parsed.body })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_comment_added',
    resourceType: 'task',
    resourceId: taskId,
    result: 'success',
    metadata: { commentId: created.id }
  });

  revalidatePath('/dashboard/my-work');
  return created;
}

export async function updateTaskComment(commentId: string, input: UpdateTaskCommentInput) {
  const [comment] = await db.select().from(taskComments).where(eq(taskComments.id, commentId)).limit(1);
  if (!comment) throw new Error('Comment not found');
  const caller = await requireActiveEmployee();
  if (comment.authorEmployeeId !== caller.id) {
    throw new Error('Only the author can edit this comment');
  }
  const parsed = updateTaskCommentSchema.parse(input);

  const [updated] = await db
    .update(taskComments)
    .set({ body: parsed.body, updatedAt: new Date() })
    .where(eq(taskComments.id, commentId))
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_comment_updated',
    resourceType: 'task',
    resourceId: comment.taskId,
    result: 'success',
    metadata: { commentId }
  });

  revalidatePath('/dashboard/my-work');
  return updated;
}

export async function removeTaskComment(commentId: string) {
  const [comment] = await db.select().from(taskComments).where(eq(taskComments.id, commentId)).limit(1);
  if (!comment) throw new Error('Comment not found');
  const caller = await requireActiveEmployee();
  if (comment.authorEmployeeId !== caller.id && caller.role !== 'ADMIN') {
    throw new Error('Only the author or an ADMIN can remove this comment');
  }

  await db.delete(taskComments).where(eq(taskComments.id, commentId));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_comment_removed',
    resourceType: 'task',
    resourceId: comment.taskId,
    result: 'success',
    metadata: { commentId }
  });

  revalidatePath('/dashboard/my-work');
}
