import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import {
  automationRuns,
  automations,
  calendarEventAttendees,
  calendarEvents,
  clients,
  documentLinks,
  employees,
  enquiries,
  integrations,
  projectMilestones,
  projects
} from '@/lib/db/schema';
import { AUTOMATION_KEYS } from '@/lib/automations/keys';
import { INTEGRATION_KEYS } from '@/lib/integrations/keys';
import { createQueuedRun, markRunFailed } from '@/lib/queue/audit-run';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: vi.fn() }));

const { default: HomePage } = await import('@/app/dashboard/page');

const runTag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAdmin = `test_${runTag}_admin`;
const clerkIdEmployee = `test_${runTag}_employee`;

let adminId: string;
let clientWithDocsId: string;
let clientWithoutDocsId: string;
let projectId: string;
let failedRunId: string;

beforeAll(async () => {
  const [admin] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdAdmin,
      name: `Dashboard Admin ${runTag}`,
      email: `${clerkIdAdmin}@example.test`,
      role: 'ADMIN',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  adminId = admin.id;
  await db.insert(employees).values({
    clerkUserId: clerkIdEmployee,
    name: `Dashboard Employee ${runTag}`,
    email: `${clerkIdEmployee}@example.test`,
    role: 'EMPLOYEE',
    team: 'alpha',
    status: 'active'
  });

  await db.insert(enquiries).values({
    contactName: `Waiting Contact ${runTag}`,
    contactEmail: 'contact@example.test',
    team: 'alpha',
    status: 'awaiting_response',
    createdBy: adminId
  });

  const [withDocs] = await db.insert(clients).values({ name: `Has Docs Client ${runTag}`, team: 'alpha' }).returning();
  clientWithDocsId = withDocs.id;
  await db.insert(documentLinks).values({
    label: 'A doc',
    url: 'https://example.test/doc',
    system: 'other',
    clientId: clientWithDocsId,
    addedByEmployeeId: adminId
  });
  const [withoutDocs] = await db
    .insert(clients)
    .values({ name: `No Docs Client ${runTag}`, team: 'alpha' })
    .returning();
  clientWithoutDocsId = withoutDocs.id;

  const [project] = await db
    .insert(projects)
    .values({ name: `Dashboard Project ${runTag}`, clientId: clientWithDocsId, team: 'alpha' })
    .returning();
  projectId = project.id;
  await db.insert(projectMilestones).values({
    projectId,
    title: `Due-soon milestone ${runTag}`,
    dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  });

  // Two overlapping meetings the admin created, to trip the calendar-conflicts section.
  const meetingStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const meetingEnd = new Date(meetingStart.getTime() + 60 * 60 * 1000);
  await db.insert(calendarEvents).values([
    { title: `Conflict A ${runTag}`, team: 'alpha', createdByEmployeeId: adminId, startAt: meetingStart, endAt: meetingEnd },
    {
      title: `Conflict B ${runTag}`,
      team: 'alpha',
      createdByEmployeeId: adminId,
      startAt: new Date(meetingStart.getTime() + 30 * 60 * 1000),
      endAt: new Date(meetingEnd.getTime() + 30 * 60 * 1000)
    }
  ]);

  const [automation] = await db.select().from(automations).where(eq(automations.key, AUTOMATION_KEYS.NEW_ENQUIRY)).limit(1);
  failedRunId = await createQueuedRun(automation.id);
  await markRunFailed(failedRunId, `Simulated failure ${runTag}`);

  await db
    .update(integrations)
    .set({ status: 'error', lastError: `Simulated integration error ${runTag}` })
    .where(eq(integrations.key, INTEGRATION_KEYS.HOSTINGER_MAIL));
});

afterAll(async () => {
  await db.delete(automationRuns).where(eq(automationRuns.id, failedRunId));
  await db
    .update(integrations)
    .set({ status: 'not_configured', lastError: null })
    .where(eq(integrations.key, INTEGRATION_KEYS.HOSTINGER_MAIL));
  await db.delete(calendarEventAttendees).where(eq(calendarEventAttendees.employeeId, adminId));
  await db.delete(calendarEvents).where(eq(calendarEvents.createdByEmployeeId, adminId));
  await db.delete(projectMilestones).where(eq(projectMilestones.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(documentLinks).where(eq(documentLinks.clientId, clientWithDocsId));
  await db.delete(clients).where(eq(clients.id, clientWithDocsId));
  await db.delete(clients).where(eq(clients.id, clientWithoutDocsId));
  await db.delete(enquiries).where(eq(enquiries.team, 'alpha'));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAdmin));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdEmployee));
});

describe('HomePage — Unified Action Centre', () => {
  it('shows every section, correctly filtered, for an ADMIN', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAdmin });

    const element = await HomePage();
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Workload overview');
    expect(html).toContain('Task status');
    expect(html).toContain('Open tasks by priority');
    expect(html).toContain('Deadlines — next 14 days');
    expect(html).toContain(`Waiting Contact ${runTag}`);
    expect(html).toContain(`No Docs Client ${runTag}`);
    expect(html).not.toContain(`Has Docs Client ${runTag}`);
    expect(html).toContain(`Due-soon milestone ${runTag}`);
    expect(html).toContain(`Conflict A ${runTag}`);
    expect(html).toContain(`overlaps &quot;Conflict B ${runTag}&quot;`);
    expect(html).toContain(`Simulated failure ${runTag}`);
    expect(html).toContain(`Simulated integration error ${runTag}`);
  });

  it('hides automation-failure and integration-error sections from a plain EMPLOYEE', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdEmployee });

    const element = await HomePage();
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).not.toContain('Automation failures');
    expect(html).not.toContain('Integration errors');
  });
});
