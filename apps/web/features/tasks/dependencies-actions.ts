'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { taskDependencies, tasks } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { canEditTask, canViewTask } from '@/lib/permissions/task-access';
import { addTaskDependencySchema, type AddTaskDependencyInput } from './utils/schemas';

// Walks the "depends on" graph outward from `startTaskId` to see whether `targetTaskId` is
// reachable — used to reject an edge that would create a cycle (A depends on B depends on A)
// before it's ever written, since nothing at the DB layer prevents that (schema.ts's comment on
// task_dependencies).
async function wouldCreateCycle(startTaskId: string, targetTaskId: string): Promise<boolean> {
  let frontier = [startTaskId];
  const visited = new Set<string>();

  while (frontier.length > 0) {
    if (frontier.includes(targetTaskId)) return true;
    for (const id of frontier) visited.add(id);

    const rows = await db
      .select({ dependsOnTaskId: taskDependencies.dependsOnTaskId })
      .from(taskDependencies)
      .where(inArray(taskDependencies.taskId, frontier));

    frontier = [...new Set(rows.map((r) => r.dependsOnTaskId))].filter((id) => !visited.has(id));
  }

  return false;
}

export async function addTaskDependency(taskId: string, input: AddTaskDependencyInput) {
  const parsed = addTaskDependencySchema.parse(input);
  if (taskId === parsed.dependsOnTaskId) throw new Error('A task cannot depend on itself');

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error('Task not found');
  const [dependsOn] = await db.select().from(tasks).where(eq(tasks.id, parsed.dependsOnTaskId)).limit(1);
  if (!dependsOn) throw new Error('The task it depends on was not found');

  const caller = await requireActiveEmployee();
  if (!canEditTask(caller, { id: task.id, assigneeId: task.assigneeId, team: task.team })) {
    throw new Error('Not permitted to edit this task');
  }
  if (!canViewTask(caller, { id: dependsOn.id, assigneeId: dependsOn.assigneeId, team: dependsOn.team })) {
    throw new Error('Not permitted to link to that task');
  }

  if (await wouldCreateCycle(parsed.dependsOnTaskId, taskId)) {
    throw new Error('That would create a circular dependency');
  }

  const [existing] = await db
    .select({ id: taskDependencies.id })
    .from(taskDependencies)
    .where(and(eq(taskDependencies.taskId, taskId), eq(taskDependencies.dependsOnTaskId, parsed.dependsOnTaskId)))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(taskDependencies)
    .values({ taskId, dependsOnTaskId: parsed.dependsOnTaskId })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_dependency_added',
    resourceType: 'task',
    resourceId: taskId,
    result: 'success',
    metadata: { dependsOnTaskId: parsed.dependsOnTaskId }
  });

  revalidatePath('/dashboard/my-work');
  return created;
}

export async function removeTaskDependency(dependencyId: string) {
  const [dependency] = await db
    .select()
    .from(taskDependencies)
    .where(eq(taskDependencies.id, dependencyId))
    .limit(1);
  if (!dependency) throw new Error('Dependency not found');

  const [task] = await db.select().from(tasks).where(eq(tasks.id, dependency.taskId)).limit(1);
  if (!task) throw new Error('Task not found');

  const caller = await requireActiveEmployee();
  if (!canEditTask(caller, { id: task.id, assigneeId: task.assigneeId, team: task.team })) {
    throw new Error('Not permitted to edit this task');
  }

  await db.delete(taskDependencies).where(eq(taskDependencies.id, dependencyId));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_dependency_removed',
    resourceType: 'task',
    resourceId: dependency.taskId,
    result: 'success',
    metadata: { dependsOnTaskId: dependency.dependsOnTaskId }
  });

  revalidatePath('/dashboard/my-work');
}
