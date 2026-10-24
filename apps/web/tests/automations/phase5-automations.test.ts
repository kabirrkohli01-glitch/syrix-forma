import type { Job } from 'bullmq';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db/client';
import {
  automationRuns,
  automations,
  automationSettings,
  clients,
  clientStaff,
  employees,
  notifications,
  projectMilestones,
  projects
} from '@/lib/db/schema';
import { handleClientInactivityFollowUp } from '@/lib/automations/client-inactivity-follow-up';
import { AUTOMATION_KEYS } from '@/lib/automations/keys';
import { handleProjectDeadlineReminder } from '@/lib/automations/project-deadline-reminder';

function fakeJob<T extends object>(data: T): Job<T> {
  return { data } as Job<T>;
}

async function latestRun(automationKey: (typeof AUTOMATION_KEYS)[keyof typeof AUTOMATION_KEYS]) {
  const [automation] = await db.select().from(automations).where(eq(automations.key, automationKey)).limit(1);
  const [run] = await db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, automation.id))
    .orderBy(desc(automationRuns.createdAt))
    .limit(1);
  return run;
}

const runTag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkId = `test_${runTag}_employee`;

let employeeId: string;
const createdClientIds: string[] = [];
const createdProjectIds: string[] = [];

beforeAll(async () => {
  const [employee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkId,
      name: `Phase5 Automation Employee ${runTag}`,
      email: `${clerkId}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  employeeId = employee.id;
});

afterAll(async () => {
  for (const id of createdProjectIds) await db.delete(projects).where(eq(projects.id, id));
  for (const id of createdClientIds) await db.delete(clients).where(eq(clients.id, id));
  await db.delete(employees).where(eq(employees.id, employeeId));
});

afterEach(async () => {
  await db.update(automationSettings).set({ killSwitchEnabled: true }).where(eq(automationSettings.id, 'singleton'));
  await db.update(automations).set({ enabled: true });
});

describe('handleClientInactivityFollowUp', () => {
  it('notifies staff for a client with no recent task/note/email activity, and stamps lastInactivityNotifiedAt', async () => {
    const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const [client] = await db
      .insert(clients)
      .values({ name: `Inactive Client ${runTag}`, team: 'alpha', createdAt: longAgo, updatedAt: longAgo })
      .returning();
    createdClientIds.push(client.id);
    await db.insert(clientStaff).values({ clientId: client.id, employeeId });

    await handleClientInactivityFollowUp(fakeJob({}));

    const run = await latestRun(AUTOMATION_KEYS.CLIENT_INACTIVITY_FOLLOW_UP);
    expect(run.status).toBe('success');
    expect((run.result as { notifiedClientIds: string[] }).notifiedClientIds).toContain(client.id);

    const [updatedClient] = await db.select().from(clients).where(eq(clients.id, client.id)).limit(1);
    expect(updatedClient.lastInactivityNotifiedAt).not.toBeNull();

    const [notification] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.employeeId, employeeId), eq(notifications.type, 'client_inactive')))
      .orderBy(desc(notifications.createdAt))
      .limit(1);
    expect(notification).toBeDefined();
  });

  it('does not notify a client created recently (within the threshold)', async () => {
    const [client] = await db.insert(clients).values({ name: `Fresh Client ${runTag}`, team: 'alpha' }).returning();
    createdClientIds.push(client.id);

    await handleClientInactivityFollowUp(fakeJob({}));

    const run = await latestRun(AUTOMATION_KEYS.CLIENT_INACTIVITY_FOLLOW_UP);
    expect((run.result as { notifiedClientIds: string[] }).notifiedClientIds).not.toContain(client.id);

    const [unchangedClient] = await db.select().from(clients).where(eq(clients.id, client.id)).limit(1);
    expect(unchangedClient.lastInactivityNotifiedAt).toBeNull();
  });

  it('records a skipped run when the automation is turned off', async () => {
    await db.update(automations).set({ enabled: false }).where(eq(automations.key, AUTOMATION_KEYS.CLIENT_INACTIVITY_FOLLOW_UP));

    await handleClientInactivityFollowUp(fakeJob({}));

    const run = await latestRun(AUTOMATION_KEYS.CLIENT_INACTIVITY_FOLLOW_UP);
    expect(run.status).toBe('skipped');
  });
});

describe('handleProjectDeadlineReminder', () => {
  it('notifies project staff for an incomplete milestone due within the configured window', async () => {
    const [client] = await db.insert(clients).values({ name: `Deadline Client ${runTag}`, team: 'alpha' }).returning();
    createdClientIds.push(client.id);
    const [project] = await db
      .insert(projects)
      .values({ name: `Deadline Project ${runTag}`, clientId: client.id, team: 'alpha' })
      .returning();
    createdProjectIds.push(project.id);
    const soon = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    const [milestone] = await db
      .insert(projectMilestones)
      .values({ projectId: project.id, title: 'Milestone due soon', dueDate: soon })
      .returning();

    await handleProjectDeadlineReminder(fakeJob({}));

    const run = await latestRun(AUTOMATION_KEYS.PROJECT_DEADLINE_REMINDER);
    expect(run.status).toBe('success');
    expect((run.result as { notifiedMilestoneIds: string[] }).notifiedMilestoneIds).toContain(milestone.id);

    const [updatedMilestone] = await db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.id, milestone.id))
      .limit(1);
    expect(updatedMilestone.lastReminderSentAt).not.toBeNull();
  });

  it('skips a milestone that is already completed', async () => {
    const [client] = await db.insert(clients).values({ name: `Completed Deadline Client ${runTag}`, team: 'alpha' }).returning();
    createdClientIds.push(client.id);
    const [project] = await db
      .insert(projects)
      .values({ name: `Completed Deadline Project ${runTag}`, clientId: client.id, team: 'alpha' })
      .returning();
    createdProjectIds.push(project.id);
    const soon = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    const [milestone] = await db
      .insert(projectMilestones)
      .values({ projectId: project.id, title: 'Already done', dueDate: soon, completedAt: new Date() })
      .returning();

    await handleProjectDeadlineReminder(fakeJob({}));

    const run = await latestRun(AUTOMATION_KEYS.PROJECT_DEADLINE_REMINDER);
    expect((run.result as { notifiedMilestoneIds: string[] }).notifiedMilestoneIds).not.toContain(milestone.id);
  });
});
