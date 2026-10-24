import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { automationRuns, automations, automationSettings, clients, employees, enquiries, notifications, projects, tasks } from '@/lib/db/schema';
import { handleNewEnquiry } from '@/lib/automations/new-enquiry';
import { handleNoResponseFollowUp } from '@/lib/automations/no-response-follow-up';
import { handleTaskCompletedProjectSync } from '@/lib/automations/task-completed-project-sync';
import { triggerNewEnquiry, scheduleNoResponseFollowUp } from '@/lib/automations/trigger';
import { AUTOMATION_KEYS } from '@/lib/automations/keys';
import { createQueuedRun, getAutomationByKey } from '@/lib/queue/audit-run';

// These tests call the automation handlers directly with a fake Job — no real BullMQ/Redis
// involved. The enqueue side (Queue.add actually reaching a worker) was verified manually
// against the live Upstash instance; it doesn't need to run on every CI PR. What does need
// covering here, and what CI runs on every PR, is the business logic: what an automation does
// once triggered, and what the kill-switches do to it.
//
// Email is mocked, not real: it's an external network call to Resend that CI has no reason to
// make on every PR (and no guarantee RESEND_API_KEY is even configured for), same reasoning as
// mocking Clerk's `auth()` in the authorization tests elsewhere in this suite.
const mockSendEmail = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/notifications/email', () => ({ sendEmail: (...args: unknown[]) => mockSendEmail(...args) }));

function fakeJob<T extends object>(data: T): Job<T> {
  return { data } as Job<T>;
}

const runTag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkId = `test_${runTag}_employee`;

let employeeId: string;
let clientId: string;
const createdEnquiryIds: string[] = [];
const createdTaskIds: string[] = [];
const createdRunIds: string[] = [];
const createdNotificationIds: string[] = [];
const createdProjectIds: string[] = [];

beforeAll(async () => {
  const [employee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkId,
      name: 'Automation Test Employee',
      email: `${clerkId}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  employeeId = employee.id;

  const [client] = await db
    .insert(clients)
    .values({ name: `Automation Test Client ${runTag}`, team: 'alpha' })
    .returning();
  clientId = client.id;
});

afterAll(async () => {
  for (const id of createdTaskIds) await db.delete(tasks).where(eq(tasks.id, id));
  for (const id of createdNotificationIds) await db.delete(notifications).where(eq(notifications.id, id));
  for (const id of createdRunIds) await db.delete(automationRuns).where(eq(automationRuns.id, id));
  for (const id of createdEnquiryIds) await db.delete(enquiries).where(eq(enquiries.id, id));
  for (const id of createdProjectIds) await db.delete(projects).where(eq(projects.id, id));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(employees).where(eq(employees.id, employeeId));
});

afterEach(async () => {
  // Belt-and-suspenders: restore both switches to their default "on" state after every test,
  // even if a test fails before its own restore runs.
  await db.update(automationSettings).set({ killSwitchEnabled: true }).where(eq(automationSettings.id, 'singleton'));
  await db.update(automations).set({ enabled: true });
  mockSendEmail.mockReset().mockResolvedValue({ ok: true });
});

let enquiryCounter = 0;

// A unique contactName per call matters: several tests look up the task/notification this
// automation creates by title, and without uniqueness those lookups collide with rows left
// over from earlier tests in the same run (cleanup only happens in afterAll, by design, so
// each test can assert against the DB state it created without an afterEach wipe racing it).
async function makeEnquiry(overrides: Partial<typeof enquiries.$inferInsert> = {}) {
  enquiryCounter += 1;
  const [enquiry] = await db
    .insert(enquiries)
    .values({
      contactName: `Test Contact ${runTag}_${enquiryCounter}`,
      contactEmail: 'contact@example.test',
      team: 'alpha',
      createdBy: employeeId,
      ...overrides
    })
    .returning();
  createdEnquiryIds.push(enquiry.id);
  return enquiry;
}

describe('handleNewEnquiry', () => {
  it('creates a task and an in-app notification, and marks the run successful', async () => {
    const enquiry = await makeEnquiry();
    const automation = await getAutomationByKey(AUTOMATION_KEYS.NEW_ENQUIRY);
    const runId = await createQueuedRun(automation.id, {
      triggerResourceType: 'enquiry',
      triggerResourceId: enquiry.id
    });
    createdRunIds.push(runId);

    await handleNewEnquiry(fakeJob({ runId, enquiryId: enquiry.id }));

    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
    expect(run.status).toBe('success');

    const [task] = await db.select().from(tasks).where(eq(tasks.title, `New enquiry: ${enquiry.contactName}`));
    expect(task).toBeDefined();
    if (task) createdTaskIds.push(task.id);

    const [notification] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.employeeId, employeeId), eq(notifications.type, 'enquiry_task_created')));
    expect(notification).toBeDefined();
    if (notification) createdNotificationIds.push(notification.id);
  });

  // Forces the exact failure the build plan's Phase 3 done-when line calls for: a clear error
  // state in run history, without losing work that already succeeded (Section 7's "email
  // failure must degrade, not cascade" — see lib/notifications/email.ts).
  it('marks the run failed on an email error, but keeps the task and notification it already created', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: false, error: 'simulated Resend failure' });

    const enquiry = await makeEnquiry();
    const automation = await getAutomationByKey(AUTOMATION_KEYS.NEW_ENQUIRY);
    const runId = await createQueuedRun(automation.id, {
      triggerResourceType: 'enquiry',
      triggerResourceId: enquiry.id
    });
    createdRunIds.push(runId);

    await handleNewEnquiry(fakeJob({ runId, enquiryId: enquiry.id }));

    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
    expect(run.status).toBe('failed');
    expect(run.error).toContain('simulated Resend failure');

    const [task] = await db.select().from(tasks).where(eq(tasks.title, `New enquiry: ${enquiry.contactName}`));
    expect(task).toBeDefined();
    if (task) createdTaskIds.push(task.id);

    const [notification] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.employeeId, employeeId), eq(notifications.type, 'enquiry_task_created')));
    expect(notification).toBeDefined();
    if (notification) createdNotificationIds.push(notification.id);

    // markRunFailed notifies every active ADMIN — including any real admin account that
    // happens to exist in this dev DB, not just test fixtures. Must clean those up explicitly;
    // they aren't scoped to this test's own employee/enquiry ids the way everything else is.
    const adminNotifs = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.type, 'automation_failed'), eq(notifications.title, `Automation failed: ${automation.name}`)));
    expect(adminNotifs.length).toBeGreaterThan(0);
    for (const n of adminNotifs) await db.delete(notifications).where(eq(notifications.id, n.id));
  });

  it('records a skipped run and creates nothing when the automation is disabled', async () => {
    const enquiry = await makeEnquiry();
    const automation = await getAutomationByKey(AUTOMATION_KEYS.NEW_ENQUIRY);
    await db.update(automations).set({ enabled: false }).where(eq(automations.id, automation.id));

    const runId = await createQueuedRun(automation.id, {
      triggerResourceType: 'enquiry',
      triggerResourceId: enquiry.id
    });
    createdRunIds.push(runId);

    await handleNewEnquiry(fakeJob({ runId, enquiryId: enquiry.id }));

    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
    expect(run.status).toBe('skipped');

    const [task] = await db.select().from(tasks).where(eq(tasks.title, `New enquiry: ${enquiry.contactName}`));
    expect(task).toBeUndefined();
  });
});

describe('handleNoResponseFollowUp', () => {
  it('sends a follow-up notification when the enquiry is still awaiting_response', async () => {
    const enquiry = await makeEnquiry({ status: 'awaiting_response' });
    const automation = await getAutomationByKey(AUTOMATION_KEYS.NO_RESPONSE_FOLLOW_UP);
    const runId = await createQueuedRun(automation.id, {
      triggerResourceType: 'enquiry',
      triggerResourceId: enquiry.id
    });
    createdRunIds.push(runId);

    await handleNoResponseFollowUp(fakeJob({ runId, enquiryId: enquiry.id }));

    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
    expect(run.status).toBe('success');

    const [notification] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.employeeId, employeeId), eq(notifications.type, 'follow_up_due')));
    expect(notification).toBeDefined();
    if (notification) createdNotificationIds.push(notification.id);
  });

  // The one subtle correctness point in this phase: a delayed job must re-check the enquiry's
  // CURRENT status when it fires, not the status it had when the job was scheduled — otherwise
  // resolving an enquiry during the delay window doesn't stop a stale follow-up from firing.
  it('skips without notifying when the enquiry is no longer awaiting_response by the time the job runs', async () => {
    const enquiry = await makeEnquiry({ status: 'responded' });
    const automation = await getAutomationByKey(AUTOMATION_KEYS.NO_RESPONSE_FOLLOW_UP);
    const runId = await createQueuedRun(automation.id, {
      triggerResourceType: 'enquiry',
      triggerResourceId: enquiry.id
    });
    createdRunIds.push(runId);

    await handleNoResponseFollowUp(fakeJob({ runId, enquiryId: enquiry.id }));

    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
    expect(run.status).toBe('skipped');
    expect(run.result).toMatchObject({ reason: expect.stringContaining('responded') });

    const [notification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.title, `Follow up: ${enquiry.contactName}`));
    expect(notification).toBeUndefined();
  });
});

describe('master kill-switch', () => {
  it('triggerNewEnquiry records a skipped run and never enqueues when the master switch is off', async () => {
    await db.update(automationSettings).set({ killSwitchEnabled: false }).where(eq(automationSettings.id, 'singleton'));
    const enquiry = await makeEnquiry();

    await triggerNewEnquiry(enquiry.id);

    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.triggerResourceId, enquiry.id));
    expect(run.status).toBe('skipped');
    createdRunIds.push(run.id);

    const [task] = await db.select().from(tasks).where(eq(tasks.title, `New enquiry: ${enquiry.contactName}`));
    expect(task).toBeUndefined();
  });

  it('scheduleNoResponseFollowUp records a skipped run and never enqueues when the master switch is off', async () => {
    await db.update(automationSettings).set({ killSwitchEnabled: false }).where(eq(automationSettings.id, 'singleton'));
    const enquiry = await makeEnquiry({ status: 'awaiting_response' });

    await scheduleNoResponseFollowUp(enquiry.id);

    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.triggerResourceId, enquiry.id));
    expect(run.status).toBe('skipped');
    createdRunIds.push(run.id);
  });
});

let projectCounter = 0;

async function makeProject() {
  projectCounter += 1;
  const [project] = await db
    .insert(projects)
    .values({ clientId, name: `Automation Test Project ${runTag}_${projectCounter}`, team: 'alpha' })
    .returning();
  createdProjectIds.push(project.id);
  return project;
}

async function makeProjectTask(projectId: string, status: 'todo' | 'done' = 'todo') {
  const [task] = await db.insert(tasks).values({ title: `Project task ${runTag}`, team: 'alpha', projectId, status }).returning();
  createdTaskIds.push(task.id);
  return task;
}

describe('handleTaskCompletedProjectSync', () => {
  it("marks the project completed when the completed task was the last one remaining", async () => {
    const project = await makeProject();
    const task = await makeProjectTask(project.id, 'done');
    const automation = await getAutomationByKey(AUTOMATION_KEYS.TASK_COMPLETED_PROJECT_SYNC);
    const runId = await createQueuedRun(automation.id, { triggerResourceType: 'task', triggerResourceId: task.id });
    createdRunIds.push(runId);

    await handleTaskCompletedProjectSync(fakeJob({ runId, taskId: task.id }));

    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
    expect(run.status).toBe('success');
    expect(run.result).toMatchObject({ projectCompleted: true });

    const [updatedProject] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(updatedProject.status).toBe('completed');
  });

  it('does not complete the project while another task on it is still open', async () => {
    const project = await makeProject();
    const doneTask = await makeProjectTask(project.id, 'done');
    await makeProjectTask(project.id, 'todo');
    const automation = await getAutomationByKey(AUTOMATION_KEYS.TASK_COMPLETED_PROJECT_SYNC);
    const runId = await createQueuedRun(automation.id, {
      triggerResourceType: 'task',
      triggerResourceId: doneTask.id
    });
    createdRunIds.push(runId);

    await handleTaskCompletedProjectSync(fakeJob({ runId, taskId: doneTask.id }));

    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
    expect(run.status).toBe('success');
    expect(run.result).toMatchObject({ projectCompleted: false });

    const [updatedProject] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(updatedProject.status).not.toBe('completed');
  });

  it('skips a task that is not linked to any project', async () => {
    const [task] = await db.insert(tasks).values({ title: `Unlinked task ${runTag}`, team: 'alpha', status: 'done' }).returning();
    createdTaskIds.push(task.id);
    const automation = await getAutomationByKey(AUTOMATION_KEYS.TASK_COMPLETED_PROJECT_SYNC);
    const runId = await createQueuedRun(automation.id, { triggerResourceType: 'task', triggerResourceId: task.id });
    createdRunIds.push(runId);

    await handleTaskCompletedProjectSync(fakeJob({ runId, taskId: task.id }));

    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
    expect(run.status).toBe('skipped');
  });

  // Same stale-trigger principle as no-response-follow-up: the task may have been reopened
  // between enqueue and execution — re-check its current status, not the status at enqueue time.
  it('skips when the task is no longer done by the time the job runs', async () => {
    const project = await makeProject();
    const task = await makeProjectTask(project.id, 'todo');
    const automation = await getAutomationByKey(AUTOMATION_KEYS.TASK_COMPLETED_PROJECT_SYNC);
    const runId = await createQueuedRun(automation.id, { triggerResourceType: 'task', triggerResourceId: task.id });
    createdRunIds.push(runId);

    await handleTaskCompletedProjectSync(fakeJob({ runId, taskId: task.id }));

    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
    expect(run.status).toBe('skipped');

    const [updatedProject] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(updatedProject.status).not.toBe('completed');
  });
});
