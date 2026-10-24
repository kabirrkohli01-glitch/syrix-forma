import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { checklistItems, employees, taskComments, taskDependencies, taskWatchers, tasks } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/automations/trigger', () => ({ triggerTaskCompleted: vi.fn() }));

const { completeTask, createTask } = await import('@/features/tasks/actions');
const { addChecklistItem, removeChecklistItem, updateChecklistItem } = await import(
  '@/features/tasks/checklist-actions'
);
const { addTaskComment, removeTaskComment, updateTaskComment } = await import('@/features/tasks/comments-actions');
const { addTaskWatcher, removeTaskWatcher } = await import('@/features/tasks/watchers-actions');
const { addTaskDependency } = await import('@/features/tasks/dependencies-actions');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAlphaEmployee = `test_${runId}_alpha_employee`;
const clerkIdAlphaEmployee2 = `test_${runId}_alpha_employee2`;
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
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdBetaEmployee));
});

describe('subtasks', () => {
  it('inherits team/client/project from the parent and requires view access to it', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const parent = await createTask({ title: 'Parent task', assigneeId: alphaEmployeeId });
    createdTaskIds.push(parent.id);

    const subtask = await createTask({
      title: 'Subtask',
      assigneeId: alphaEmployeeId,
      parentTaskId: parent.id
    });
    createdTaskIds.push(subtask.id);

    expect(subtask.parentTaskId).toBe(parent.id);
    expect(subtask.team).toBe('alpha');

    mockAuth.mockResolvedValue({ userId: clerkIdBetaEmployee });
    await expect(
      createTask({ title: 'Cross-team subtask', assigneeId: betaEmployeeId, parentTaskId: parent.id })
    ).rejects.toThrow();
  });
});

describe('checklist items', () => {
  it('lets the assignee add/toggle/remove, rejects a non-assignee teammate', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const task = await createTask({ title: 'Checklist task', assigneeId: alphaEmployeeId });
    createdTaskIds.push(task.id);

    const item = await addChecklistItem(task.id, { label: 'Step one' });
    const toggled = await updateChecklistItem(item.id, { done: true });
    expect(toggled.done).toBe(true);

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee2 });
    await expect(addChecklistItem(task.id, { label: 'Not allowed' })).rejects.toThrow();

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    await removeChecklistItem(item.id);
    const [remaining] = await db.select().from(checklistItems).where(eq(checklistItems.id, item.id)).limit(1);
    expect(remaining).toBeUndefined();
  });
});

describe('comments', () => {
  it('lets any viewer comment but only the author edit/delete their own comment', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const task = await createTask({ title: 'Comment task', assigneeId: alphaEmployeeId });
    createdTaskIds.push(task.id);
    const comment = await addTaskComment(task.id, { body: 'First comment' });

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee2 });
    await expect(updateTaskComment(comment.id, { body: 'Hijacked' })).rejects.toThrow();
    await expect(removeTaskComment(comment.id)).rejects.toThrow();

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const edited = await updateTaskComment(comment.id, { body: 'Edited' });
    expect(edited.body).toBe('Edited');
    await removeTaskComment(comment.id);
    const [remaining] = await db.select().from(taskComments).where(eq(taskComments.id, comment.id)).limit(1);
    expect(remaining).toBeUndefined();
  });
});

describe('watchers', () => {
  it('lets anyone who can view the task watch themselves, requires edit access to watch someone else', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const task = await createTask({ title: 'Watched task', assigneeId: alphaEmployeeId });
    createdTaskIds.push(task.id);

    mockAuth.mockResolvedValue({ userId: clerkIdBetaEmployee });
    await expect(addTaskWatcher(task.id)).rejects.toThrow();

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const watcher = await addTaskWatcher(task.id);
    const [row] = await db.select().from(taskWatchers).where(eq(taskWatchers.id, watcher.id)).limit(1);
    expect(row).toBeDefined();

    // The assignee has edit access, so they can add someone else as a watcher too.
    const othersWatcher = await addTaskWatcher(task.id, { employeeId: alphaEmployee2Id });
    expect(othersWatcher).toBeDefined();

    // alphaEmployee2 is on the same team but not the assignee — plain EMPLOYEE scope is 'own',
    // so they have neither view nor edit access to add anyone (including themselves) as a watcher.
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee2 });
    await expect(addTaskWatcher(task.id, { employeeId: alphaEmployeeId })).rejects.toThrow();

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    await removeTaskWatcher(task.id);
    const [removed] = await db.select().from(taskWatchers).where(eq(taskWatchers.id, watcher.id)).limit(1);
    expect(removed).toBeUndefined();
  });
});

describe('dependencies', () => {
  it('rejects a self-dependency and a circular dependency', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const taskA = await createTask({ title: 'Task A', assigneeId: alphaEmployeeId });
    createdTaskIds.push(taskA.id);
    const taskB = await createTask({ title: 'Task B', assigneeId: alphaEmployeeId });
    createdTaskIds.push(taskB.id);

    await expect(addTaskDependency(taskA.id, { dependsOnTaskId: taskA.id })).rejects.toThrow();

    const dependency = await addTaskDependency(taskA.id, { dependsOnTaskId: taskB.id });
    const [row] = await db.select().from(taskDependencies).where(eq(taskDependencies.id, dependency.id)).limit(1);
    expect(row).toBeDefined();

    // B already (transitively) depends on nothing that includes A, but A -> B exists, so
    // B -> A would close the loop.
    await expect(addTaskDependency(taskB.id, { dependsOnTaskId: taskA.id })).rejects.toThrow();
  });
});

describe('recurrence', () => {
  it('generates the next occurrence when a recurring task is completed', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const dueDate = new Date('2026-01-01T00:00:00Z');
    const task = await createTask({
      title: 'Recurring task',
      assigneeId: alphaEmployeeId,
      dueDate,
      recurrenceRule: { frequency: 'weekly', interval: 1 }
    });
    createdTaskIds.push(task.id);

    await completeTask(task.id);

    const nextOccurrence = await db
      .select()
      .from(tasks)
      .where(eq(tasks.recurrenceOfTaskId, task.id));
    expect(nextOccurrence).toHaveLength(1);
    createdTaskIds.push(nextOccurrence[0].id);
    expect(nextOccurrence[0].dueDate?.toISOString()).toBe(new Date('2026-01-08T00:00:00Z').toISOString());
    expect(nextOccurrence[0].status).toBe('todo');
  });
});
