import type { Job } from 'bullmq';
import { and, eq, inArray, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees, projectMilestones, projects, projectStaff } from '@/lib/db/schema';
import { createNotification } from '@/lib/notifications/in-app';
import { isAutomationsEnabled } from '@/lib/queue/kill-switch';
import {
  createQueuedRun,
  createSkippedRun,
  getAutomationByKey,
  markRunFailed,
  markRunRunning,
  markRunSuccess
} from '@/lib/queue/audit-run';
import { AUTOMATION_KEYS } from './keys';

// Same fallback shape as client-inactivity-follow-up.ts's resolveClientRecipients: staffed
// employees first, then the project's own team leads/managers/admins, then every active ADMIN.
async function resolveProjectRecipients(projectId: string, team: string): Promise<{ id: string }[]> {
  const staffed = await db
    .select({ id: employees.id })
    .from(projectStaff)
    .innerJoin(employees, eq(projectStaff.employeeId, employees.id))
    .where(and(eq(projectStaff.projectId, projectId), eq(employees.status, 'active')));
  if (staffed.length > 0) return staffed;

  const teamLeadsOrAbove = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.team, team),
        eq(employees.status, 'active'),
        inArray(employees.role, ['TEAM_LEAD', 'MANAGER', 'ADMIN'])
      )
    );
  if (teamLeadsOrAbove.length > 0) return teamLeadsOrAbove;

  return db.select({ id: employees.id }).from(employees).where(and(eq(employees.role, 'ADMIN'), eq(employees.status, 'active')));
}

// Reminded at most once per ~20 hours per milestone, same resend guard task-reminders.ts uses —
// not calendar-day-exact, just "not again within roughly the same day" if the daily scan is ever
// re-run (e.g. a worker restart). A milestone still within the reminder window gets reminded
// again on each subsequent day's scan until it's completed, same as a task's own due-date scan.
const RESEND_GUARD_MS = 20 * 60 * 60 * 1000;

type ProjectDeadlineJobData = { runId?: string };

// EVENT (daily scan) -> RULE (an incomplete milestone due within its configurable window, or
// already overdue) -> ACTION (notify project staff) -> RESULT -> AUDIT. Same "owns its own
// run-row lifecycle" shape as client-inactivity-follow-up.ts, for the same reason.
export async function handleProjectDeadlineReminder(_job: Job<ProjectDeadlineJobData>): Promise<void> {
  const automation = await getAutomationByKey(AUTOMATION_KEYS.PROJECT_DEADLINE_REMINDER);

  if (!(await isAutomationsEnabled())) {
    await createSkippedRun(automation.id, 'Master automation kill-switch is off');
    return;
  }
  if (!automation.enabled) {
    await createSkippedRun(automation.id, 'This automation is turned off');
    return;
  }

  const runId = await createQueuedRun(automation.id);
  await markRunRunning(runId);

  try {
    const config = (automation.config ?? {}) as { daysBeforeDeadline?: number };
    const daysBeforeDeadline = typeof config.daysBeforeDeadline === 'number' ? config.daysBeforeDeadline : 3;
    const now = new Date();
    const horizon = new Date(now.getTime() + daysBeforeDeadline * 24 * 60 * 60 * 1000);
    const notRemindedSince = new Date(now.getTime() - RESEND_GUARD_MS);

    const dueMilestones = await db
      .select({
        id: projectMilestones.id,
        title: projectMilestones.title,
        dueDate: projectMilestones.dueDate,
        projectId: projectMilestones.projectId
      })
      .from(projectMilestones)
      .where(
        and(
          isNull(projectMilestones.completedAt),
          isNotNull(projectMilestones.dueDate),
          lte(projectMilestones.dueDate, horizon),
          or(isNull(projectMilestones.lastReminderSentAt), lt(projectMilestones.lastReminderSentAt, notRemindedSince))
        )
      );

    const notifiedMilestoneIds: string[] = [];

    for (const milestone of dueMilestones) {
      const [project] = await db.select().from(projects).where(eq(projects.id, milestone.projectId)).limit(1);
      if (!project || project.status === 'completed' || project.status === 'cancelled') continue;

      const recipients = await resolveProjectRecipients(project.id, project.team);
      const overdue = milestone.dueDate! < now;

      await Promise.all(
        recipients.map((recipient) =>
          createNotification({
            employeeId: recipient.id,
            type: 'project_milestone_due_soon',
            title: overdue ? `Overdue: ${milestone.title}` : `Due soon: ${milestone.title}`,
            body: `${project.name} — ${milestone.title} is ${overdue ? 'overdue' : `due within ${daysBeforeDeadline} days`}.`,
            link: `/dashboard/projects/${project.id}`
          })
        )
      );

      await db.update(projectMilestones).set({ lastReminderSentAt: now }).where(eq(projectMilestones.id, milestone.id));
      notifiedMilestoneIds.push(milestone.id);
    }

    await markRunSuccess(runId, { notifiedMilestoneIds, daysBeforeDeadline });
  } catch (err) {
    await markRunFailed(runId, err);
  }
}
