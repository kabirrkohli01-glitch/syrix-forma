import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees, tasks } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
// revalidatePath requires a live Next.js request/render context, which doesn't exist in a
// plain vitest process — the actions under test call it as a side effect, so it's stubbed out
// rather than asserted on.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// triggerTaskCompleted enqueues a real BullMQ job against the live Redis instance — completing
// a task in this test file otherwise created real automation_runs/jobs for a task row this
// file's own afterAll then deletes, leaving stray "task no longer exists" failures for whatever
// worker eventually picks the job up. Mocked out for the same reason revalidatePath is.
vi.mock('@/lib/automations/trigger', () => ({ triggerTaskCompleted: vi.fn() }));

const { archiveTask, assignTask, completeTask, createTask, updateTask } = await import(
  '@/features/tasks/actions'
);

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAlphaEmployee = `test_${runId}_alpha_employee`;
const clerkIdAlphaEmployee2 = `test_${runId}_alpha_employee2`;
const clerkIdAlphaLead = `test_${runId}_alpha_lead`;
const clerkIdBetaEmployee = `test_${runId}_beta_employee`;

let alphaEmployeeId: string;
let alphaEmployee2Id: string;
let betaEmployeeId: string;
const createdTaskIds: string[] = [];

beforeAll(async () => {
  const [alphaEmployee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdAlphaEmployee,
      name: 'Alpha Employee',
      email: `${clerkIdAlphaEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  const [alphaEmployee2] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdAlphaEmployee2,
      name: 'Alpha Employee 2',
      email: `${clerkIdAlphaEmployee2}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  await db.insert(employees).values({
    clerkUserId: clerkIdAlphaLead,
    name: 'Alpha Lead',
    email: `${clerkIdAlphaLead}@example.test`,
    role: 'TEAM_LEAD',
    team: 'alpha',
    status: 'active'
  });
  const [betaEmployee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdBetaEmployee,
      name: 'Beta Employee',
      email: `${clerkIdBetaEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'beta',
      status: 'active'
    })
    .returning();

  alphaEmployeeId = alphaEmployee.id;
  alphaEmployee2Id = alphaEmployee2.id;
  betaEmployeeId = betaEmployee.id;
});

afterAll(async () => {
  for (const id of createdTaskIds) {
    await db.delete(tasks).where(eq(tasks.id, id));
  }
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaEmployee));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaEmployee2));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaLead));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdBetaEmployee));
});

describe('createTask', () => {
  it('lets an EMPLOYEE create and self-assign a task, defaulting team to their own', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const created = await createTask({ title: 'Self-assigned task', assigneeId: alphaEmployeeId });
    createdTaskIds.push(created.id);

    expect(created.team).toBe('alpha');
    expect(created.assigneeId).toBe(alphaEmployeeId);
    expect(created.status).toBe('todo');
  });

  it('rejects an EMPLOYEE creating a task outside their own team', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    await expect(createTask({ title: 'Wrong team task', team: 'beta' })).rejects.toThrow();
  });

  it('rejects an EMPLOYEE assigning a new task to a teammate', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    await expect(
      createTask({ title: 'Assign to teammate', assigneeId: alphaEmployee2Id })
    ).rejects.toThrow();
  });

  it('lets a TEAM_LEAD create and assign a task to a same-team employee', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createTask({
      title: 'Lead-assigned task',
      assigneeId: alphaEmployee2Id
    });
    createdTaskIds.push(created.id);

    expect(created.assigneeId).toBe(alphaEmployee2Id);
  });

  it('rejects a TEAM_LEAD assigning a new task to a different-team employee', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    await expect(
      createTask({ title: 'Cross-team assign', assigneeId: betaEmployeeId })
    ).rejects.toThrow();
  });
});

describe('updateTask / completeTask / archiveTask', () => {
  it('lets the assignee edit and complete their own task, rejects a non-assignee teammate', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const created = await createTask({ title: 'Editable task', assigneeId: alphaEmployeeId });
    createdTaskIds.push(created.id);

    const updated = await updateTask(created.id, { title: 'Edited title' });
    expect(updated.title).toBe('Edited title');

    const completed = await completeTask(created.id);
    expect(completed.status).toBe('done');

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee2 });
    await expect(updateTask(created.id, { title: 'Should fail' })).rejects.toThrow();
  });

  it('archives a task (soft delete) without removing the row', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const created = await createTask({ title: 'Archivable task', assigneeId: alphaEmployeeId });
    createdTaskIds.push(created.id);

    const archived = await archiveTask(created.id);
    expect(archived.archivedAt).not.toBeNull();

    const [stillExists] = await db.select().from(tasks).where(eq(tasks.id, created.id)).limit(1);
    expect(stillExists).toBeDefined();
  });
});

describe('assignTask', () => {
  it('lets a TEAM_LEAD reassign a task within their own team', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createTask({ title: 'Reassignable task', assigneeId: alphaEmployeeId });
    createdTaskIds.push(created.id);

    const reassigned = await assignTask(created.id, { assigneeId: alphaEmployee2Id });
    expect(reassigned.assigneeId).toBe(alphaEmployee2Id);
  });

  it('rejects a TEAM_LEAD assigning a task to a different-team employee', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createTask({ title: 'Cross-team reassign', assigneeId: alphaEmployeeId });
    createdTaskIds.push(created.id);

    await expect(assignTask(created.id, { assigneeId: betaEmployeeId })).rejects.toThrow();
  });

  it('rejects a plain EMPLOYEE from assigning at all', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const created = await createTask({ title: 'No-assign task', assigneeId: alphaEmployeeId });
    createdTaskIds.push(created.id);

    await expect(assignTask(created.id, { assigneeId: alphaEmployee2Id })).rejects.toThrow();
  });
});
