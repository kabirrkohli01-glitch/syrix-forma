import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { calendarEventAttendees, calendarEvents, employees } from '@/lib/db/schema';

// Same rationale as tests/tasks/task-detail-page.test.ts and tests/tasks/my-work-page.test.ts:
// no dev-only auth bypass and no browser-automation tool available in this environment, so the
// Calendar page is verified by rendering it directly against the live dev database.
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: vi.fn() }));

// EventCalendar (a 'use client' component) calls next/navigation's router hooks, which throw
// outside a real mounted app router — irrelevant to what this test checks (the server-rendered
// event data), so stubbed the same way tests/tasks/my-work-page.test.ts stubs them.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn() }),
    usePathname: () => '/dashboard/calendar',
    useSearchParams: () => new URLSearchParams()
  };
});

const { default: CalendarPage } = await import('@/app/dashboard/calendar/page');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdEmployee = `test_${runId}_employee`;
const clerkIdOtherTeam = `test_${runId}_other_team`;

let employeeId: string;
let otherTeamEmployeeId: string;

beforeAll(async () => {
  const [employee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdEmployee,
      name: 'Calendar Page Employee',
      email: `${clerkIdEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  const [otherTeamEmployee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdOtherTeam,
      name: 'Other Team Employee',
      email: `${clerkIdOtherTeam}@example.test`,
      role: 'EMPLOYEE',
      team: 'beta',
      status: 'active'
    })
    .returning();
  employeeId = employee.id;
  otherTeamEmployeeId = otherTeamEmployee.id;

  const now = new Date();

  const [ownEvent] = await db
    .insert(calendarEvents)
    .values({ title: 'My own meeting', team: 'alpha', createdByEmployeeId: employeeId, startAt: now, endAt: now })
    .returning();
  await db.insert(calendarEventAttendees).values({ eventId: ownEvent.id, employeeId });

  await db.insert(calendarEvents).values({
    title: "Someone else's beta-team meeting",
    team: 'beta',
    createdByEmployeeId: otherTeamEmployeeId,
    startAt: now,
    endAt: now
  });
});

afterAll(async () => {
  await db.delete(calendarEvents).where(eq(calendarEvents.team, 'alpha'));
  await db.delete(calendarEvents).where(eq(calendarEvents.team, 'beta'));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdEmployee));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdOtherTeam));
});

describe('CalendarPage', () => {
  it("renders the caller's own event but not a different team's uninvolved event (own scope)", async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdEmployee });

    const element = await CalendarPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('My own meeting');
    expect(html).not.toContain("Someone else's beta-team meeting");
  });
});
