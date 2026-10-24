'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import {
  clients,
  projectMilestones,
  projectTemplateMilestones,
  projectTemplates,
  projectTemplateTasks,
  projects,
  tasks
} from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireRole } from '@/lib/permissions/current-employee';
import { teamForNewRecord } from '@/lib/permissions/default-team';
import {
  addTemplateMilestoneSchema,
  addTemplateTaskSchema,
  createProjectFromTemplateSchema,
  createProjectTemplateSchema,
  type AddTemplateMilestoneInput,
  type AddTemplateTaskInput,
  type CreateProjectFromTemplateInput,
  type CreateProjectTemplateInput
} from './utils/schemas';

const TEMPLATES_PATH = '/dashboard/settings/project-templates';

export async function createProjectTemplate(input: CreateProjectTemplateInput) {
  const caller = await requireRole('TEAM_LEAD', 'MANAGER', 'ADMIN');
  const parsed = createProjectTemplateSchema.parse(input);

  const [created] = await db
    .insert(projectTemplates)
    .values({ name: parsed.name, serviceLine: parsed.serviceLine ?? null, createdByEmployeeId: caller.id })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_template_created',
    resourceType: 'project_template',
    resourceId: created.id,
    result: 'success',
    metadata: { name: parsed.name, serviceLine: parsed.serviceLine }
  });

  revalidatePath(TEMPLATES_PATH);
  return created;
}

export async function deleteProjectTemplate(templateId: string) {
  const caller = await requireRole('TEAM_LEAD', 'MANAGER', 'ADMIN');

  await db.delete(projectTemplates).where(eq(projectTemplates.id, templateId));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_template_deleted',
    resourceType: 'project_template',
    resourceId: templateId,
    result: 'success'
  });

  revalidatePath(TEMPLATES_PATH);
}

export async function addTemplateTask(templateId: string, input: AddTemplateTaskInput) {
  const caller = await requireRole('TEAM_LEAD', 'MANAGER', 'ADMIN');
  const parsed = addTemplateTaskSchema.parse(input);

  const [created] = await db
    .insert(projectTemplateTasks)
    .values({
      templateId,
      title: parsed.title,
      description: parsed.description ?? null,
      priority: parsed.priority ?? 'medium',
      relativeDueDays: parsed.relativeDueDays ?? null
    })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_template_task_added',
    resourceType: 'project_template',
    resourceId: templateId,
    result: 'success',
    metadata: { templateTaskId: created.id }
  });

  revalidatePath(TEMPLATES_PATH);
  return created;
}

export async function removeTemplateTask(templateTaskId: string) {
  const caller = await requireRole('TEAM_LEAD', 'MANAGER', 'ADMIN');
  const [row] = await db
    .select({ templateId: projectTemplateTasks.templateId })
    .from(projectTemplateTasks)
    .where(eq(projectTemplateTasks.id, templateTaskId))
    .limit(1);
  if (!row) throw new Error('Template task not found');

  await db.delete(projectTemplateTasks).where(eq(projectTemplateTasks.id, templateTaskId));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_template_task_removed',
    resourceType: 'project_template',
    resourceId: row.templateId,
    result: 'success',
    metadata: { templateTaskId }
  });

  revalidatePath(TEMPLATES_PATH);
}

export async function addTemplateMilestone(templateId: string, input: AddTemplateMilestoneInput) {
  const caller = await requireRole('TEAM_LEAD', 'MANAGER', 'ADMIN');
  const parsed = addTemplateMilestoneSchema.parse(input);

  const [created] = await db
    .insert(projectTemplateMilestones)
    .values({ templateId, title: parsed.title, relativeDueDays: parsed.relativeDueDays ?? null })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_template_milestone_added',
    resourceType: 'project_template',
    resourceId: templateId,
    result: 'success',
    metadata: { templateMilestoneId: created.id }
  });

  revalidatePath(TEMPLATES_PATH);
  return created;
}

export async function removeTemplateMilestone(templateMilestoneId: string) {
  const caller = await requireRole('TEAM_LEAD', 'MANAGER', 'ADMIN');
  const [row] = await db
    .select({ templateId: projectTemplateMilestones.templateId })
    .from(projectTemplateMilestones)
    .where(eq(projectTemplateMilestones.id, templateMilestoneId))
    .limit(1);
  if (!row) throw new Error('Template milestone not found');

  await db.delete(projectTemplateMilestones).where(eq(projectTemplateMilestones.id, templateMilestoneId));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_template_milestone_removed',
    resourceType: 'project_template',
    resourceId: row.templateId,
    result: 'success',
    metadata: { templateMilestoneId }
  });

  revalidatePath(TEMPLATES_PATH);
}

// The actual point of a template: stand up a real project pre-populated with real tasks and
// milestones, each due date computed from the chosen start date + the template row's own
// relativeDueDays — the template itself never stores an absolute date, only an offset.
export async function createProjectFromTemplate(input: CreateProjectFromTemplateInput) {
  const caller = await requireRole('TEAM_LEAD', 'MANAGER', 'ADMIN');
  const parsed = createProjectFromTemplateSchema.parse(input);

  const [client] = await db.select().from(clients).where(eq(clients.id, parsed.clientId)).limit(1);
  if (!client) throw new Error('Client not found');

  let team = teamForNewRecord(caller.team);
  if (parsed.team && parsed.team !== team) {
    if (caller.role !== 'ADMIN') throw new Error('Only an ADMIN can create a project outside your own team');
    team = parsed.team;
  }

  const [templateTasks, templateMilestones] = await Promise.all([
    db.select().from(projectTemplateTasks).where(eq(projectTemplateTasks.templateId, parsed.templateId)),
    db.select().from(projectTemplateMilestones).where(eq(projectTemplateMilestones.templateId, parsed.templateId))
  ]);

  function dueDateFor(relativeDueDays: number | null): Date | null {
    if (relativeDueDays === null) return null;
    const due = new Date(parsed.startDate);
    due.setDate(due.getDate() + relativeDueDays);
    return due;
  }

  const created = await db.transaction(async (tx) => {
    const [project] = await tx.insert(projects).values({ clientId: parsed.clientId, name: parsed.name, team }).returning();

    if (templateTasks.length > 0) {
      await tx.insert(tasks).values(
        templateTasks.map((t) => ({
          title: t.title,
          description: t.description,
          priority: t.priority,
          dueDate: dueDateFor(t.relativeDueDays),
          team,
          clientId: parsed.clientId,
          projectId: project.id
        }))
      );
    }

    if (templateMilestones.length > 0) {
      await tx.insert(projectMilestones).values(
        templateMilestones.map((m) => ({
          projectId: project.id,
          title: m.title,
          dueDate: dueDateFor(m.relativeDueDays)
        }))
      );
    }

    return project;
  });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_created_from_template',
    resourceType: 'project',
    resourceId: created.id,
    result: 'success',
    metadata: { templateId: parsed.templateId, taskCount: templateTasks.length, milestoneCount: templateMilestones.length }
  });

  revalidatePath('/dashboard/projects');
  return created;
}
