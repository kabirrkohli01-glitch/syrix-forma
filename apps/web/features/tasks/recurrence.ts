import { db } from '@/lib/db/client';
import { tasks } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import type { RecurrenceRule } from './utils/schemas';

function nextDueDate(rule: RecurrenceRule, from: Date): Date {
  const next = new Date(from);
  if (rule.frequency === 'daily') next.setDate(next.getDate() + rule.interval);
  else if (rule.frequency === 'weekly') next.setDate(next.getDate() + rule.interval * 7);
  else next.setMonth(next.getMonth() + rule.interval);
  return next;
}

type CompletedTask = typeof tasks.$inferSelect;

// Called from completeTask right after a task with a recurrenceRule transitions to 'done'.
// Generates the next occurrence as a new row rather than resetting this one, so the completed
// task stays a real, permanent record of that occurrence (audit history, the build plan's
// general soft-delete/never-erase posture). The new row carries the same rule forward, so the
// series continues indefinitely until someone clears recurrenceRule on the newest occurrence.
export async function generateNextOccurrence(completed: CompletedTask): Promise<void> {
  if (!completed.recurrenceRule) return;

  const rule = completed.recurrenceRule as RecurrenceRule;
  const baseline = completed.dueDate ?? completed.updatedAt;
  const dueDate = nextDueDate(rule, baseline);

  const [created] = await db
    .insert(tasks)
    .values({
      title: completed.title,
      description: completed.description,
      priority: completed.priority,
      dueDate,
      team: completed.team,
      assigneeId: completed.assigneeId,
      clientId: completed.clientId,
      projectId: completed.projectId,
      recurrenceRule: rule,
      recurrenceOfTaskId: completed.recurrenceOfTaskId ?? completed.id
    })
    .returning();

  await logAuditEvent({
    actorEmployeeId: null,
    action: 'task_recurrence_generated',
    resourceType: 'task',
    resourceId: created.id,
    result: 'success',
    metadata: { generatedFromTaskId: completed.id, dueDate: dueDate.toISOString() }
  });
}
