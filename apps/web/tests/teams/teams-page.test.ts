import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { clients, employees, projects, tasks } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: vi.fn() }));

const { default: TeamsPage } = await import('@/app/dashboard/teams/page');

const runTag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const teamAlpha = `alpha-${runTag}`;
const teamBeta = `beta-${runTag}`;
const clerkIdLead = `test_${runTag}_lead`;
const clerkIdEmployee = `test_${runTag}_employee`;
const clerkIdManager = `test_${runTag}_manager`;

const createdTaskIds: string[] = [];
const createdProjectIds: string[] = [];
const createdClientIds: string[] = [];

beforeAll(async () => {
  await db.insert(employees).values([
    {
      clerkUserId: clerkIdLead,
      name: `Alpha Lead ${runTag}`,
      email: `${clerkIdLead}@example.test`,
      role: 'TEAM_LEAD',
      team: teamAlpha,
      status: 'active'
    },
    {
      clerkUserId: clerkIdEmployee,
      name: `Alpha Employee ${runTag}`,
      email: `${clerkIdEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: teamAlpha,
      status: 'active'
    },
    {
      clerkUserId: clerkIdManager,
      name: `Beta Manager ${runTag}`,
      email: `${clerkIdManager}@example.test`,
      role: 'MANAGER',
      team: teamBeta,
      status: 'active'
    }
  ]);

  const [client] = await db.insert(clients).values({ name: `Alpha Client ${runTag}`, team: teamAlpha }).returning();
  createdClientIds.push(client.id);
  const [project] = await db
    .insert(projects)
    .values({ name: `Alpha Project ${runTag}`, clientId: client.id, team: teamAlpha })
    .returning();
  createdProjectIds.push(project.id);
  const [task] = await db.insert(tasks).values({ title: `Alpha Task ${runTag}`, team: teamAlpha }).returning();
  createdTaskIds.push(task.id);
});

afterAll(async () => {
  for (const id of createdTaskIds) await db.delete(tasks).where(eq(tasks.id, id));
  for (const id of createdProjectIds) await db.delete(projects).where(eq(projects.id, id));
  for (const id of createdClientIds) await db.delete(clients).where(eq(clients.id, id));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdLead));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdEmployee));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdManager));
});

describe('TeamsPage', () => {
  it('scopes a TEAM_LEAD to only their own team, with real member/stat counts', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdLead });

    const element = await TeamsPage();
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain(teamAlpha);
    expect(html).toContain(`Alpha Lead ${runTag}`);
    expect(html).toContain(`Alpha Employee ${runTag}`);

    // A team *card* — its membership, and its open task, project and client counts — is the
    // scoped part of this page, and a TEAM_LEAD must still only get their own.
    //
    // This assertion used to be `not.toContain(teamBeta)` against the whole page. That stopped
    // holding when the company-wide status board was added: it lists every active employee
    // grouped by team for anyone who can open this page, which is the entire point of it being
    // company-wide (docs/permissions-matrix.md, "Team Status"). The name of another team is not
    // the confidential thing; that team's workload and membership are.
    // Matched on the card title slot rather than on a class name: the status board's own group
    // headings are `capitalize` too, so a class-based match would not tell the two apart.
    const cardTitles = html.match(/data-slot="card-title"[^>]*>([^<]*)/g) ?? [];
    expect(cardTitles.some((title) => title.includes(teamAlpha))).toBe(true);
    expect(cardTitles.some((title) => title.includes(teamBeta))).toBe(false);
  });

  it('shows every team to a MANAGER (cross-team scope)', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdManager });

    const element = await TeamsPage();
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain(teamAlpha);
    expect(html).toContain(teamBeta);
  });
});
