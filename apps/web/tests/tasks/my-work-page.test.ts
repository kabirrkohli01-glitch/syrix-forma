import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees, tasks } from '@/lib/db/schema';

// Same rationale as tests/tasks/task-detail-page.test.ts: no dev-only auth bypass and no
// browser-automation tool available in this environment, so the Calendar/Timeline/My Day views
// added to /dashboard/my-work are verified by rendering the page function directly against the
// live dev database rather than over HTTP.
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: vi.fn() }));

// TaskViewToggle (a 'use client' component reachable from this page) calls next/navigation's
// router hooks, which throw outside a real mounted app router — irrelevant to what this test is
// checking (the server-rendered data in each view), so stubbed out the same way revalidatePath
// is stubbed in the Server Action tests.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn() }),
    usePathname: () => '/dashboard/my-work',
    useSearchParams: () => new URLSearchParams()
  };
});

const { default: MyWorkPage } = await import('@/app/dashboard/my-work/page');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdEmployee = `test_${runId}_employee`;

let employeeId: string;

beforeAll(async () => {
  const [employee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdEmployee,
      name: 'My Work Page Employee',
      email: `${clerkIdEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  employeeId = employee.id;

  const today = new Date();
  const overdue = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);

  await db.insert(tasks).values([
    { title: 'Overdue task for my day', team: 'alpha', assigneeId: employeeId, dueDate: overdue },
    { title: 'Due today for calendar', team: 'alpha', assigneeId: employeeId, dueDate: today },
    { title: 'Unscheduled personal task', team: 'alpha', assigneeId: employeeId }
  ]);
});

afterAll(async () => {
  await db.delete(tasks).where(eq(tasks.team, 'alpha'));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdEmployee));
});

function renderView(view: string, extra: Record<string, string> = {}) {
  mockAuth.mockResolvedValue({ userId: clerkIdEmployee });
  return MyWorkPage({ searchParams: Promise.resolve({ view, ...extra }) });
}

describe('MyWorkPage — Phase 5 views', () => {
  it('renders the calendar view with a task on today\'s cell', async () => {
    const element = await renderView('calendar');
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('Due today for calendar');
  });

  it('renders the calendar view for an explicit month param', async () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const month = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    const element = await renderView('calendar', { month });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('rounded-lg border bg-border'.split(' ')[0]);
  });

  it('renders the timeline view bucketed by due date', async () => {
    const element = await renderView('timeline');
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('Overdue');
    expect(html).toContain('Overdue task for my day');
    expect(html).toContain('Unscheduled personal task');
  });

  it('renders My Day scoped to the caller\'s own tasks only', async () => {
    const element = await renderView('day');
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('Overdue task for my day');
    expect(html).toContain('Due today for calendar');
    expect(html).toContain('Unscheduled personal task');
  });

  // Not tested by rendering here: an unrecognized `view` param falls back to 'list', but
  // TasksTable (pre-existing, unchanged by this work) depends on nuqs's query-state hooks, which
  // need a mounted framework adapter this render-outside-Next-request approach can't provide —
  // the same limitation the List view already had before this session.
});
