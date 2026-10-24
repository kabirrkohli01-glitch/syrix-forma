import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees, projectTemplateMilestones, projectTemplates, projectTemplateTasks } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: vi.fn() }));

const { default: ProjectTemplatesPage } = await import('@/app/dashboard/settings/project-templates/page');

const runTag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdLead = `test_${runTag}_lead`;
const clerkIdEmployee = `test_${runTag}_employee`;

let templateId: string;

beforeAll(async () => {
  await db.insert(employees).values([
    {
      clerkUserId: clerkIdLead,
      name: `Templates Page Lead ${runTag}`,
      email: `${clerkIdLead}@example.test`,
      role: 'TEAM_LEAD',
      team: 'alpha',
      status: 'active'
    },
    {
      clerkUserId: clerkIdEmployee,
      name: `Templates Page Employee ${runTag}`,
      email: `${clerkIdEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    }
  ]);

  const [template] = await db
    .insert(projectTemplates)
    .values({ name: `Visible Template ${runTag}`, serviceLine: 'Advisory' })
    .returning();
  templateId = template.id;
  await db.insert(projectTemplateTasks).values({ templateId, title: `Template task ${runTag}`, relativeDueDays: 5 });
  await db
    .insert(projectTemplateMilestones)
    .values({ templateId, title: `Template milestone ${runTag}`, relativeDueDays: 20 });
});

afterAll(async () => {
  await db.delete(projectTemplates).where(eq(projectTemplates.id, templateId));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdLead));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdEmployee));
});

describe('ProjectTemplatesPage', () => {
  it('renders a template with its tasks and milestones for a TEAM_LEAD', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdLead });

    const element = await ProjectTemplatesPage();
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain(`Visible Template ${runTag}`);
    expect(html).toContain(`Template task ${runTag}`);
    expect(html).toContain(`Template milestone ${runTag}`);
  });

  it('404s a plain EMPLOYEE (no confirmation the route exists)', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdEmployee });

    await expect(ProjectTemplatesPage()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/);
  });
});
