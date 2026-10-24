import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { automations, automationRuns, employees } from '@/lib/db/schema';
import { createNotification } from '@/lib/notifications/in-app';
import type { AutomationKey } from '@/lib/automations/keys';

export type AutomationRow = typeof automations.$inferSelect;

export async function getAutomationByKey(key: AutomationKey): Promise<AutomationRow> {
  const [row] = await db.select().from(automations).where(eq(automations.key, key)).limit(1);
  if (!row) throw new Error(`Automation '${key}' is not seeded — check the migrations ran`);
  return row;
}

type TriggerRef = { triggerResourceType?: string; triggerResourceId?: string };

// Written at enqueue time, before the job is even picked up — this is what lets the
// Automations page show a delayed follow-up job as "queued" while it waits out its delay,
// rather than run history only appearing once execution starts.
export async function createQueuedRun(automationId: string, trigger: TriggerRef = {}): Promise<string> {
  const [run] = await db
    .insert(automationRuns)
    .values({
      automationId,
      status: 'queued',
      triggerResourceType: trigger.triggerResourceType ?? null,
      triggerResourceId: trigger.triggerResourceId ?? null
    })
    .returning({ id: automationRuns.id });
  return run.id;
}

// Used when a trigger is blocked before a job is ever enqueued (kill-switch off at trigger
// time) — there's no "queued" state to pass through since nothing was queued.
export async function createSkippedRun(
  automationId: string,
  reason: string,
  trigger: TriggerRef = {}
): Promise<string> {
  const [run] = await db
    .insert(automationRuns)
    .values({
      automationId,
      status: 'skipped',
      triggerResourceType: trigger.triggerResourceType ?? null,
      triggerResourceId: trigger.triggerResourceId ?? null,
      result: { reason },
      finishedAt: new Date()
    })
    .returning({ id: automationRuns.id });
  return run.id;
}

export async function markRunRunning(runId: string): Promise<void> {
  await db.update(automationRuns).set({ status: 'running', startedAt: new Date() }).where(eq(automationRuns.id, runId));
}

export async function markRunSuccess(runId: string, result?: Record<string, unknown>): Promise<void> {
  await db
    .update(automationRuns)
    .set({ status: 'success', finishedAt: new Date(), result: result ?? null })
    .where(eq(automationRuns.id, runId));
}

// Notifies every active ADMIN — automations are ADMIN-only configuration
// (docs/permissions-matrix.md), so they're the ones who can act on a failure (disable it, fix
// the underlying issue, use the kill-switch). A failure that only ever shows up in the run-history
// table is easy to miss; this is what the build plan's "automation failures" notification bullet
// actually requires; without it, an admin would have to remember to check the page.
async function notifyAdminsOfFailure(automationId: string, message: string): Promise<void> {
  const [automation] = await db.select({ name: automations.name }).from(automations).where(eq(automations.id, automationId)).limit(1);
  const admins = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.role, 'ADMIN'), eq(employees.status, 'active')));

  await Promise.all(
    admins.map((admin) =>
      createNotification({
        employeeId: admin.id,
        type: 'automation_failed',
        title: `Automation failed: ${automation?.name ?? automationId}`,
        body: message,
        link: '/dashboard/automations'
      })
    )
  );
}

export async function markRunFailed(runId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const [run] = await db
    .update(automationRuns)
    .set({ status: 'failed', finishedAt: new Date(), error: message })
    .where(eq(automationRuns.id, runId))
    .returning({ automationId: automationRuns.automationId });

  if (run) await notifyAdminsOfFailure(run.automationId, message);
}

export async function markRunSkipped(runId: string, reason: string): Promise<void> {
  await db
    .update(automationRuns)
    .set({ status: 'skipped', finishedAt: new Date(), result: { reason } })
    .where(eq(automationRuns.id, runId));
}
