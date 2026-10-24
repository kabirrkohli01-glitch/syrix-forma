import type { Job } from 'bullmq';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { projects, tasks } from '@/lib/db/schema';
import { isAutomationsEnabled } from '@/lib/queue/kill-switch';
import { getAutomationByKey, markRunFailed, markRunRunning, markRunSkipped, markRunSuccess } from '@/lib/queue/audit-run';
import { AUTOMATION_KEYS } from './keys';

export type TaskCompletedProjectSyncJobData = { runId: string; taskId: string };

// EVENT (TASK_COMPLETED) -> RULE (this automation, if enabled, and the task is on a project) ->
// ACTION ("update project": mark it completed once every one of its tasks is done) -> RESULT ->
// AUDIT — the third example flow named in the build plan's Phase 3 section, alongside the two
// enquiry automations that are the phase's actual required deliverable.
//
// "Trigger next workflow if configured" (the build plan's phrasing) is a deliberate no-op here:
// there is no workflow-configuration concept yet for a project to point at (that's Phase 5
// territory) — so "if configured" evaluates to "not configured," honestly, rather than inventing
// a fake follow-on action to look more complete than this phase actually is.
export async function handleTaskCompletedProjectSync(job: Job<TaskCompletedProjectSyncJobData>): Promise<void> {
  const { runId, taskId } = job.data;

  const [globalEnabled, automation] = await Promise.all([
    isAutomationsEnabled(),
    getAutomationByKey(AUTOMATION_KEYS.TASK_COMPLETED_PROJECT_SYNC)
  ]);
  if (!globalEnabled || !automation.enabled) {
    await markRunSkipped(runId, 'Automation disabled before the job ran');
    return;
  }

  await markRunRunning(runId);

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) {
    await markRunFailed(runId, `Task ${taskId} no longer exists`);
    return;
  }
  if (!task.projectId) {
    await markRunSkipped(runId, 'Task is not linked to a project');
    return;
  }
  if (task.status !== 'done') {
    // Stale trigger, same principle as no-response-follow-up: re-check current state, not the
    // state at enqueue time — the task may have been reopened since this job was queued.
    await markRunSkipped(runId, `Task status is now '${task.status}', not 'done'`);
    return;
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1);
  if (!project) {
    await markRunFailed(runId, `Project ${task.projectId} no longer exists`);
    return;
  }
  if (project.status === 'completed') {
    await markRunSkipped(runId, 'Project is already completed');
    return;
  }

  const [remaining] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), isNull(tasks.archivedAt), ne(tasks.status, 'done')))
    .limit(1);

  if (remaining) {
    await markRunSuccess(runId, { projectId: project.id, projectCompleted: false });
    return;
  }

  await db.update(projects).set({ status: 'completed', updatedAt: new Date() }).where(eq(projects.id, project.id));
  await markRunSuccess(runId, { projectId: project.id, projectCompleted: true });
}
