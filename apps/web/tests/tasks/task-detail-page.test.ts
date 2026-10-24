import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { checklistItems, employees, taskComments, taskDependencies, taskWatchers, tasks } from '@/lib/db/schema';

// No dev-only auth bypass exists in this app (the engineering rules), and this app has no browser-automation
// tool available to click through a signed-in session — so a Server Component page like this one
// can't be exercised over real HTTP the way tests/authorization/*.test.ts exercises API routes.
// Rendering the page function directly (same auth-mocking approach every Server Action test in
// this repo already uses) is the next best real check: it runs every real Drizzle query and
// permission call the page makes, against the live dev database, and fails loudly on a bad
// column/join/prop-shape rather than only on a human's next click-through.
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: vi.fn() }));

const { default: TaskDetailPage } = await import('@/app/dashboard/my-work/[id]/page');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdEmployee = `test_${runId}_employee`;
const clerkIdOtherTeam = `test_${runId}_other_team`;

let employeeId: string;
let taskId: string;
let subtaskId: string;

beforeAll(async () => {
  const [employee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdEmployee,
      name: 'Detail Page Employee',
      email: `${clerkIdEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  await db.insert(employees).values({
    clerkUserId: clerkIdOtherTeam,
    name: 'Other Team Employee',
    email: `${clerkIdOtherTeam}@example.test`,
    role: 'EMPLOYEE',
    team: 'beta',
    status: 'active'
  });
  employeeId = employee.id;

  const [task] = await db
    .insert(tasks)
    .values({
      title: 'Detail page task',
      description: 'A task exercised by the page-render test',
      team: 'alpha',
      assigneeId: employeeId,
      recurrenceRule: { frequency: 'weekly', interval: 1 }
    })
    .returning();
  taskId = task.id;

  const [subtask] = await db
    .insert(tasks)
    .values({ title: 'Detail page subtask', team: 'alpha', assigneeId: employeeId, parentTaskId: taskId })
    .returning();
  subtaskId = subtask.id;

  const [dependsOn] = await db
    .insert(tasks)
    .values({ title: 'Blocking task', team: 'alpha', assigneeId: employeeId })
    .returning();

  await db.insert(checklistItems).values({ taskId, label: 'A checklist item' });
  await db.insert(taskComments).values({ taskId, authorEmployeeId: employeeId, body: 'A comment' });
  await db.insert(taskWatchers).values({ taskId, employeeId });
  await db.insert(taskDependencies).values({ taskId, dependsOnTaskId: dependsOn.id });
});

afterAll(async () => {
  await db.delete(tasks).where(eq(tasks.team, 'alpha'));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdEmployee));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdOtherTeam));
});

describe('TaskDetailPage', () => {
  it('renders every section for a task with subtasks, checklist, comments, watchers, dependencies, and recurrence', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdEmployee });

    const element = await TaskDetailPage({ params: Promise.resolve({ id: taskId }) });
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Detail page task');
    expect(html).toContain('Detail page subtask');
    expect(html).toContain('A checklist item');
    expect(html).toContain('A comment');
    expect(html).toContain('Blocking task');
    expect(html).toContain('Detail Page Employee');
  });

  it('renders the same page for a subtask, showing its parent link', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdEmployee });

    const element = await TaskDetailPage({ params: Promise.resolve({ id: subtaskId }) });
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Detail page subtask');
    expect(html).toContain('Detail page task');
  });

  it('404s (via next/navigation notFound) for an employee outside the task\'s scope', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdOtherTeam });

    await expect(TaskDetailPage({ params: Promise.resolve({ id: taskId }) })).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/
    );
  });
});
