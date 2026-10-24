'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { employees, tasks } from '@/lib/db/schema';
import { triggerTaskCompleted } from '@/lib/automations/trigger';
import { createNotification } from '@/lib/notifications/in-app';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { teamForNewRecord } from '@/lib/permissions/default-team';
import { canAssignTask, canEditTask, canViewTask, type TaskTarget } from '@/lib/permissions/task-access';
import { generateNextOccurrence } from './recurrence';
import {
  assignTaskSchema,
  createTaskSchema,
  updateTaskSchema,
  type AssignTaskInput,
  type CreateTaskInput,
  type UpdateTaskInput
} from './utils/schemas';

async function getTaskOrThrow(taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error('Task not found');
  return task;
}

function toTarget(task: { id: string; assigneeId: string | null; team: string }): TaskTarget {
  return { id: task.id, assigneeId: task.assigneeId, team: task.team };
}

async function getEmployeeTeam(employeeId: string): Promise<string | null> {
  const [row] = await db
    .select({ team: employees.team })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!row) throw new Error('Employee not found');
  return row.team;
}

export async function createTask(input: CreateTaskInput) {
  const caller = await requireActiveEmployee();
  const parsed = createTaskSchema.parse(input);

  // A subtask defaults to its parent's team/client/project — the caller must be able to see the
  // parent at all (canViewTask, not canEditTask: adding a subtask to something you can merely
  // view is the same bar as commenting/watching, not an edit of the parent itself).
  let parentDefaults: { team: string; clientId: string | null; projectId: string | null } | null = null;
  if (parsed.parentTaskId) {
    const parent = await getTaskOrThrow(parsed.parentTaskId);
    if (!canViewTask(caller, toTarget(parent))) {
      throw new Error('Not permitted to add a subtask to this task');
    }
    parentDefaults = { team: parent.team, clientId: parent.clientId, projectId: parent.projectId };
  }

  let team = teamForNewRecord(caller.team);
  if (parentDefaults) team = parentDefaults.team;
  if (parsed.team && parsed.team !== (parentDefaults?.team ?? team)) {
    if (caller.role !== 'ADMIN') {
      throw new Error("Only an ADMIN can create a task outside your own team");
    }
    team = parsed.team;
  }

  if (parsed.assigneeId && parsed.assigneeId !== caller.id) {
    const assigneeTeam = await getEmployeeTeam(parsed.assigneeId);
    // No row exists yet, so check against a not-yet-persisted target with the computed team.
    const target: TaskTarget = { id: 'unsaved', assigneeId: null, team };
    if (!canAssignTask(caller, target, assigneeTeam)) {
      await logAuditEvent({
        actorEmployeeId: caller.id,
        action: 'task_created',
        resourceType: 'task',
        result: 'denied'
      });
      throw new Error('Not permitted to assign this task to that employee');
    }
  }

  const [created] = await db
    .insert(tasks)
    .values({
      title: parsed.title,
      description: parsed.description ?? null,
      priority: parsed.priority ?? 'medium',
      dueDate: parsed.dueDate ?? null,
      team,
      assigneeId: parsed.assigneeId ?? null,
      clientId: parsed.clientId ?? (parentDefaults?.clientId ?? null),
      projectId: parsed.projectId ?? (parentDefaults?.projectId ?? null),
      parentTaskId: parsed.parentTaskId ?? null,
      recurrenceRule: parsed.recurrenceRule ?? null
    })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_created',
    resourceType: 'task',
    resourceId: created.id,
    result: 'success',
    metadata: { team, assigneeId: created.assigneeId, parentTaskId: created.parentTaskId }
  });

  revalidatePath('/dashboard/my-work');
  revalidatePath('/dashboard');
  return created;
}

export async function updateTask(taskId: string, input: UpdateTaskInput) {
  const caller = await requireActiveEmployee();
  const parsed = updateTaskSchema.parse(input);
  const task = await getTaskOrThrow(taskId);

  if (!canEditTask(caller, toTarget(task))) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'task_updated',
      resourceType: 'task',
      resourceId: taskId,
      result: 'denied'
    });
    throw new Error('Not permitted to edit this task');
  }

  if (parsed.team && parsed.team !== task.team && caller.role !== 'ADMIN') {
    throw new Error("Only an ADMIN can change a task's team");
  }

  const [updated] = await db
    .update(tasks)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_updated',
    resourceType: 'task',
    resourceId: taskId,
    result: 'success',
    metadata: { fields: Object.keys(parsed) }
  });

  // Fires on the transition into 'done', not on every save that merely keeps it 'done'.
  if (parsed.status === 'done' && task.status !== 'done') {
    await triggerTaskCompleted(taskId);
    await generateNextOccurrence(updated);
  }

  revalidatePath('/dashboard/my-work');
  revalidatePath('/dashboard');
  return updated;
}

export async function completeTask(taskId: string) {
  const caller = await requireActiveEmployee();
  const task = await getTaskOrThrow(taskId);

  if (!canEditTask(caller, toTarget(task))) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'task_completed',
      resourceType: 'task',
      resourceId: taskId,
      result: 'denied'
    });
    throw new Error('Not permitted to complete this task');
  }

  const wasAlreadyDone = task.status === 'done';

  const [updated] = await db
    .update(tasks)
    .set({ status: 'done', updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_completed',
    resourceType: 'task',
    resourceId: taskId,
    result: 'success'
  });

  if (!wasAlreadyDone) {
    await triggerTaskCompleted(taskId);
    await generateNextOccurrence(updated);
  }

  revalidatePath('/dashboard/my-work');
  revalidatePath('/dashboard');
  return updated;
}

export async function assignTask(taskId: string, input: AssignTaskInput) {
  const caller = await requireActiveEmployee();
  const parsed = assignTaskSchema.parse(input);
  const task = await getTaskOrThrow(taskId);
  const target = toTarget(task);

  const newAssigneeTeam = parsed.assigneeId ? await getEmployeeTeam(parsed.assigneeId) : null;

  if (!canAssignTask(caller, target, newAssigneeTeam)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'task_assigned',
      resourceType: 'task',
      resourceId: taskId,
      result: 'denied'
    });
    throw new Error('Not permitted to assign this task');
  }

  const [updated] = await db
    .update(tasks)
    .set({ assigneeId: parsed.assigneeId, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_assigned',
    resourceType: 'task',
    resourceId: taskId,
    result: 'success',
    metadata: { assigneeId: parsed.assigneeId }
  });

  // Only notify on an actual new assignment, not on unassignment, and not when someone assigns
  // a task to themselves (no point notifying yourself of your own action).
  if (parsed.assigneeId && parsed.assigneeId !== caller.id) {
    await createNotification({
      employeeId: parsed.assigneeId,
      type: 'task_assigned',
      title: `You've been assigned: ${updated.title}`,
      link: '/dashboard/my-work'
    });
  }

  revalidatePath('/dashboard/my-work');
  revalidatePath('/dashboard');
  return updated;
}

// Soft delete — archived_at is set, the row is never removed, so audit history and any
// existing references (client/project pages, audit log) stay intact.
export async function archiveTask(taskId: string) {
  const caller = await requireActiveEmployee();
  const task = await getTaskOrThrow(taskId);

  if (!canEditTask(caller, toTarget(task))) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'task_archived',
      resourceType: 'task',
      resourceId: taskId,
      result: 'denied'
    });
    throw new Error('Not permitted to archive this task');
  }

  const [updated] = await db
    .update(tasks)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_archived',
    resourceType: 'task',
    resourceId: taskId,
    result: 'success'
  });

  revalidatePath('/dashboard/my-work');
  revalidatePath('/dashboard');
  return updated;
}
