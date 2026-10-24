import type { Job } from 'bullmq';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { clientNotes, clientStaff, clients, emailActivity, employees, tasks } from '@/lib/db/schema';
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

// Falls back the same way resolveRecipients (new-enquiry.ts) does: staffed employees first, then
// an active TEAM_LEAD/MANAGER/ADMIN on the client's own team, then every active ADMIN — a client
// with nobody staffed on it still gets a real recipient rather than the notification silently
// going nowhere.
async function resolveClientRecipients(clientId: string, team: string): Promise<{ id: string }[]> {
  const staffed = await db
    .select({ id: employees.id })
    .from(clientStaff)
    .innerJoin(employees, eq(clientStaff.employeeId, employees.id))
    .where(and(eq(clientStaff.clientId, clientId), eq(employees.status, 'active')));
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

type ClientInactivityJobData = { runId?: string };

// EVENT (daily scan, no single triggering resource) -> RULE (a client with no linked task/note/
// email activity for longer than its configurable threshold) -> ACTION (notify) -> RESULT ->
// AUDIT. Unlike the event-triggered automations in this directory, there's no Server Action call
// site to pre-create a queued run before enqueueing — this handler owns its own run-row
// lifecycle, created fresh each time the repeatable scheduler fires it (worker.ts).
export async function handleClientInactivityFollowUp(_job: Job<ClientInactivityJobData>): Promise<void> {
  const automation = await getAutomationByKey(AUTOMATION_KEYS.CLIENT_INACTIVITY_FOLLOW_UP);

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
    const config = (automation.config ?? {}) as { inactivityThresholdDays?: number };
    const thresholdDays = typeof config.inactivityThresholdDays === 'number' ? config.inactivityThresholdDays : 14;
    const now = new Date();
    const cutoff = new Date(now.getTime() - thresholdDays * 24 * 60 * 60 * 1000);

    const activeClients = await db.select().from(clients).where(eq(clients.status, 'active'));
    const notifiedClientIds: string[] = [];

    for (const client of activeClients) {
      // Already flagged within this same threshold window — don't nag again until it passes.
      if (client.lastInactivityNotifiedAt && client.lastInactivityNotifiedAt >= cutoff) continue;

      const [lastTask] = await db
        .select({ updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(eq(tasks.clientId, client.id))
        .orderBy(desc(tasks.updatedAt))
        .limit(1);
      const [lastNote] = await db
        .select({ createdAt: clientNotes.createdAt })
        .from(clientNotes)
        .where(eq(clientNotes.clientId, client.id))
        .orderBy(desc(clientNotes.createdAt))
        .limit(1);
      const [lastEmail] = await db
        .select({ occurredAt: emailActivity.occurredAt })
        .from(emailActivity)
        .where(eq(emailActivity.clientId, client.id))
        .orderBy(desc(emailActivity.occurredAt))
        .limit(1);

      const lastActivity = [client.createdAt, lastTask?.updatedAt, lastNote?.createdAt, lastEmail?.occurredAt]
        .filter((d): d is Date => d instanceof Date)
        .reduce((latest, d) => (d > latest ? d : latest), client.createdAt);

      if (lastActivity >= cutoff) continue;

      const recipients = await resolveClientRecipients(client.id, client.team);
      await Promise.all(
        recipients.map((recipient) =>
          createNotification({
            employeeId: recipient.id,
            type: 'client_inactive',
            title: `No recent activity: ${client.name}`,
            body: `No linked task, note, or email activity in the last ${thresholdDays} days.`,
            link: `/dashboard/clients/${client.id}`
          })
        )
      );

      await db
        .update(clients)
        .set({ lastInactivityNotifiedAt: now })
        .where(eq(clients.id, client.id));
      notifiedClientIds.push(client.id);
    }

    await markRunSuccess(runId, { notifiedClientIds, thresholdDays });
  } catch (err) {
    await markRunFailed(runId, err);
  }
}
