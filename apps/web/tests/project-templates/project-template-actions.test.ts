import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { clients, employees, projectMilestones, projects, projectTemplates, tasks } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const {
  addTemplateMilestone,
  addTemplateTask,
  createProjectFromTemplate,
  createProjectTemplate,
  deleteProjectTemplate
} = await import('@/features/project-templates/actions');

const runTag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdLead = `test_${runTag}_lead`;
const clerkIdEmployee = `test_${runTag}_employee`;

const createdProjectIds: string[] = [];
let clientId: string;

beforeAll(async () => {
  await db.insert(employees).values({
    clerkUserId: clerkIdLead,
    name: `Template Lead ${runTag}`,
    email: `${clerkIdLead}@example.test`,
    role: 'TEAM_LEAD',
    team: 'alpha',
    status: 'active'
  });
  await db.insert(employees).values({
    clerkUserId: clerkIdEmployee,
    name: `Plain Employee ${runTag}`,
    email: `${clerkIdEmployee}@example.test`,
    role: 'EMPLOYEE',
    team: 'alpha',
    status: 'active'
  });

  const [client] = await db.insert(clients).values({ name: `Template Client ${runTag}`, team: 'alpha' }).returning();
  clientId = client.id;
});

afterAll(async () => {
  for (const id of createdProjectIds) {
    await db.delete(tasks).where(eq(tasks.projectId, id));
    await db.delete(projectMilestones).where(eq(projectMilestones.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdLead));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdEmployee));
});

describe('project templates', () => {
  it('rejects a plain EMPLOYEE creating a template, allows a TEAM_LEAD', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdEmployee });
    await expect(createProjectTemplate({ name: 'Nope' })).rejects.toThrow();

    mockAuth.mockResolvedValue({ userId: clerkIdLead });
    const template = await createProjectTemplate({ name: `Onboarding ${runTag}`, serviceLine: 'Audit' });
    expect(template.serviceLine).toBe('Audit');

    await deleteProjectTemplate(template.id);
    const [gone] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, template.id)).limit(1);
    expect(gone).toBeUndefined();
  });

  it('creates a project from a template with due dates computed relative to the chosen start date', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdLead });
    const template = await createProjectTemplate({ name: `Audit rollout ${runTag}` });
    await addTemplateTask(template.id, { title: 'Kickoff call', relativeDueDays: 0 });
    await addTemplateTask(template.id, { title: 'Draft report', relativeDueDays: 10 });
    await addTemplateTask(template.id, { title: 'No due date task' });
    await addTemplateMilestone(template.id, { title: 'Sign-off', relativeDueDays: 14 });

    const startDate = new Date('2026-03-01T00:00:00Z');
    const project = await createProjectFromTemplate({
      templateId: template.id,
      clientId,
      name: `Rollout for ${runTag}`,
      startDate
    });
    createdProjectIds.push(project.id);

    const createdTasks = await db.select().from(tasks).where(eq(tasks.projectId, project.id));
    expect(createdTasks).toHaveLength(3);
    const draftReport = createdTasks.find((t) => t.title === 'Draft report');
    expect(draftReport?.dueDate?.toISOString()).toBe(new Date('2026-03-11T00:00:00Z').toISOString());
    const noDueDateTask = createdTasks.find((t) => t.title === 'No due date task');
    expect(noDueDateTask?.dueDate).toBeNull();

    const createdMilestones = await db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, project.id));
    expect(createdMilestones).toHaveLength(1);
    expect(createdMilestones[0].dueDate?.toISOString()).toBe(new Date('2026-03-15T00:00:00Z').toISOString());

    await deleteProjectTemplate(template.id);
  });

  it('rejects a plain EMPLOYEE creating a project from a template', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdLead });
    const template = await createProjectTemplate({ name: `Denied template ${runTag}` });

    mockAuth.mockResolvedValue({ userId: clerkIdEmployee });
    await expect(
      createProjectFromTemplate({ templateId: template.id, clientId, name: 'Nope', startDate: new Date() })
    ).rejects.toThrow();

    mockAuth.mockResolvedValue({ userId: clerkIdLead });
    await deleteProjectTemplate(template.id);
  });
});
