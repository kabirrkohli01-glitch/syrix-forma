'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { taskWatchers, tasks } from '@/lib/db/schema';
import { createNotification } from '@/lib/notifications/in-app';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { canEditTask, canViewTask } from '@/lib/permissions/task-access';
import { addTaskWatcherSchema, type AddTaskWatcherInput } from './utils/schemas';

// Watching yourself only requires being able to see the task (canViewTask) — adding or removing
// someone else as a watcher is an edit of that task's notification list, gated at canEditTask,
// the same tier task assignment uses.
export async function addTaskWatcher(taskId: string, input: AddTaskWatcherInput = {}) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error('Task not found');
  const caller = await requireActiveEmployee();
  const parsed = addTaskWatcherSchema.parse(input);
  const target: { id: string; assigneeId: string | null; team: string } = {
    id: task.id,
    assigneeId: task.assigneeId,
    team: task.team
  };
  const watcherEmployeeId = parsed.employeeId ?? caller.id;
  const addingSelf = watcherEmployeeId === caller.id;

  if (addingSelf) {
    if (!canViewTask(caller, target)) throw new Error('Not permitted to view this task');
  } else if (!canEditTask(caller, target)) {
    throw new Error('Not permitted to add a watcher to this task');
  }

  const [existing] = await db
    .select({ id: taskWatchers.id })
    .from(taskWatchers)
    .where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.employeeId, watcherEmployeeId)))
    .limit(1);
  if (existing) return existing;

  const [created] = await db.insert(taskWatchers).values({ taskId, employeeId: watcherEmployeeId }).returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_watcher_added',
    resourceType: 'task',
    resourceId: taskId,
    result: 'success',
    metadata: { watcherEmployeeId }
  });

  if (!addingSelf) {
    await createNotification({
      employeeId: watcherEmployeeId,
      type: 'task_watcher_added',
      title: `You're now watching: ${task.title}`,
      link: '/dashboard/my-work'
    });
  }

  revalidatePath('/dashboard/my-work');
  return created;
}

export async function removeTaskWatcher(taskId: string, watcherEmployeeId?: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error('Task not found');
  const caller = await requireActiveEmployee();
  const target: { id: string; assigneeId: string | null; team: string } = {
    id: task.id,
    assigneeId: task.assigneeId,
    team: task.team
  };
  const employeeId = watcherEmployeeId ?? caller.id;
  const removingSelf = employeeId === caller.id;

  if (removingSelf) {
    if (!canViewTask(caller, target)) throw new Error('Not permitted to view this task');
  } else if (!canEditTask(caller, target)) {
    throw new Error('Not permitted to remove a watcher from this task');
  }

  await db
    .delete(taskWatchers)
    .where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.employeeId, employeeId)));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_watcher_removed',
    resourceType: 'task',
    resourceId: taskId,
    result: 'success',
    metadata: { watcherEmployeeId: employeeId }
  });

  revalidatePath('/dashboard/my-work');
}
