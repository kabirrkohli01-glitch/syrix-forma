import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { clientStaff, clients, documentLinks, employees, projectStaff, projects, tasks } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: vi.fn() }));

// SearchInput (a 'use client' component) calls next/navigation's useRouter, which throws outside
// a real mounted app router — same rationale as tests/tasks/my-work-page.test.ts.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, useRouter: () => ({ push: vi.fn() }) };
});

const { default: SearchPage } = await import('@/app/dashboard/search/page');

const runTag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const uniqueTerm = `Zephyrine${runTag}`;
const clerkIdAlpha = `test_${runTag}_alpha`;
const clerkIdBeta = `test_${runTag}_beta`;

let alphaEmployeeId: string;
let clientId: string;
let projectId: string;
let taskId: string;

beforeAll(async () => {
  const [alpha] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdAlpha,
      name: `Alpha ${uniqueTerm}`,
      email: `${clerkIdAlpha}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  alphaEmployeeId = alpha.id;
  await db.insert(employees).values({
    clerkUserId: clerkIdBeta,
    name: `Beta ${uniqueTerm}`,
    email: `${clerkIdBeta}@example.test`,
    role: 'EMPLOYEE',
    team: 'beta',
    status: 'active'
  });

  const [client] = await db.insert(clients).values({ name: `${uniqueTerm} Client`, team: 'alpha' }).returning();
  clientId = client.id;
  await db.insert(clientStaff).values({ clientId, employeeId: alphaEmployeeId });

  const [project] = await db
    .insert(projects)
    .values({ name: `${uniqueTerm} Project`, clientId, team: 'alpha' })
    .returning();
  projectId = project.id;
  // Project's "own" scope for an EMPLOYEE is project_staff membership, not team match
  // (project-access.ts) — same reason client_staff was needed above for the client.
  await db.insert(projectStaff).values({ projectId, employeeId: alphaEmployeeId });

  const [task] = await db
    .insert(tasks)
    .values({ title: `${uniqueTerm} Task`, team: 'alpha', assigneeId: alphaEmployeeId })
    .returning();
  taskId = task.id;

  await db.insert(documentLinks).values({
    label: `${uniqueTerm} Document`,
    url: 'https://example.test/doc',
    system: 'other',
    clientId,
    addedByEmployeeId: alphaEmployeeId
  });
});

afterAll(async () => {
  await db.delete(documentLinks).where(eq(documentLinks.clientId, clientId));
  await db.delete(tasks).where(eq(tasks.id, taskId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlpha));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdBeta));
});

function renderSearch(q: string) {
  return SearchPage({ searchParams: Promise.resolve({ q }) });
}

describe('SearchPage', () => {
  it('finds every scoped resource type by a shared search term', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });

    const element = await renderSearch(uniqueTerm);
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain(`${uniqueTerm} Client`);
    expect(html).toContain(`${uniqueTerm} Project`);
    expect(html).toContain(`${uniqueTerm} Task`);
    expect(html).toContain(`${uniqueTerm} Document`);
    expect(html).toContain(`Alpha ${uniqueTerm}`);
  });

  it('does not surface a same-named different-team client to a plain EMPLOYEE', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdBeta });

    const element = await renderSearch(uniqueTerm);
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).not.toContain(`${uniqueTerm} Client`);
    expect(html).not.toContain(`${uniqueTerm} Task`);
  });

  it('prompts for more input below the minimum query length instead of scanning everything', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });

    const element = await renderSearch('a');
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('at least');
  });
});
