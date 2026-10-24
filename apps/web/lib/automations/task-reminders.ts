import { and, eq, isNotNull, isNull, lt, lte, ne, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees, tasks } from '@/lib/db/schema';
import { createNotification } from '@/lib/notifications/in-app';
import { sendEmail } from '@/lib/notifications/email';
import { isAutomationsEnabled } from '@/lib/queue/kill-switch';

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
// Guards against reminding the same task twice if the daily job is ever re-run within the same
// rough day (e.g. a worker restart) — not calendar-day-exact, just "not again within ~20 hours".
const RESEND_GUARD_MS = 20 * 60 * 60 * 1000;

// Run once daily by the reminder queue's repeatable job (worker.ts). Not one of the build plan's
// two named automations, so it has no `automations`/`automation_runs` row of its own — it still
// respects the master kill-switch since it's automated background behavior in the same spirit.
export async function runTaskDueDateScan(): Promise<void> {
  if (!(await isAutomationsEnabled())) {
    console.warn('[task-reminders] master kill-switch is off — skipping scan');
    return;
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + REMINDER_WINDOW_MS);
  const notRemindedSince = new Date(now.getTime() - RESEND_GUARD_MS);

  const due = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      assigneeId: tasks.assigneeId
    })
    .from(tasks)
    .where(
      and(
        isNotNull(tasks.assigneeId),
        isNotNull(tasks.dueDate),
        isNull(tasks.archivedAt),
        ne(tasks.status, 'done'),
        lte(tasks.dueDate, horizon),
        or(isNull(tasks.lastReminderSentAt), lt(tasks.lastReminderSentAt, notRemindedSince))
      )
    );

  for (const task of due) {
    if (!task.assigneeId) continue;

    const [assignee] = await db
      .select({ email: employees.email })
      .from(employees)
      .where(eq(employees.id, task.assigneeId))
      .limit(1);

    const overdue = task.dueDate !== null && task.dueDate < now;
    const title = overdue ? `Overdue: ${task.title}` : `Due soon: ${task.title}`;

    await createNotification({
      employeeId: task.assigneeId,
      type: 'task_due_soon',
      title,
      body: overdue ? 'This task is overdue.' : 'This task is due within 24 hours.',
      link: '/dashboard/my-work'
    });

    if (assignee?.email) {
      const result = await sendEmail({
        to: assignee.email,
        subject: title,
        body: `${task.title} is ${overdue ? 'overdue' : 'due within 24 hours'}.`
      });
      if (!result.ok) {
        console.warn(`[task-reminders] email failed for task ${task.id}: ${result.error}`);
      }
    }

    await db.update(tasks).set({ lastReminderSentAt: now }).where(eq(tasks.id, task.id));
  }

  console.warn(`[task-reminders] scan complete — ${due.length} reminder(s) sent`);
}
