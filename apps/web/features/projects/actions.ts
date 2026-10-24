'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { clients, projectMilestones, projectStaff, projects } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee, requireRole } from '@/lib/permissions/current-employee';
import { teamForNewRecord } from '@/lib/permissions/default-team';
import {
  canEditProject,
  canManageProjectStaff,
  type ProjectTarget
} from '@/lib/permissions/project-access';
import {
  addMilestoneSchema,
  createProjectSchema,
  projectStaffAssignmentSchema,
  updateProjectSchema,
  type AddMilestoneInput,
  type CreateProjectInput,
  type ProjectStaffAssignmentInput,
  type UpdateProjectInput
} from './utils/schemas';

async function getProjectOrThrow(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error('Project not found');
  return project;
}

async function isCallerStaffed(projectId: string, employeeId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projectStaff.id })
    .from(projectStaff)
    .where(and(eq(projectStaff.projectId, projectId), eq(projectStaff.employeeId, employeeId)))
    .limit(1);
  return !!row;
}

// Same reasoning as createClient — standing up a new project is TEAM_LEAD+, not open to a
// plain EMPLOYEE.
export async function createProject(input: CreateProjectInput) {
  const caller = await requireRole('TEAM_LEAD', 'MANAGER', 'ADMIN');
  const parsed = createProjectSchema.parse(input);

  const [client] = await db.select().from(clients).where(eq(clients.id, parsed.clientId)).limit(1);
  if (!client) throw new Error('Client not found');

  let team = teamForNewRecord(caller.team);
  if (parsed.team && parsed.team !== team) {
    if (caller.role !== 'ADMIN') {
      throw new Error('Only an ADMIN can create a project outside your own team');
    }
    team = parsed.team;
  }

  const [created] = await db
    .insert(projects)
    .values({ clientId: parsed.clientId, name: parsed.name, team })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_created',
    resourceType: 'project',
    resourceId: created.id,
    result: 'success',
    metadata: { clientId: parsed.clientId, team }
  });

  revalidatePath('/dashboard/projects');
  return created;
}

export async function updateProject(projectId: string, input: UpdateProjectInput) {
  const caller = await requireActiveEmployee();
  const parsed = updateProjectSchema.parse(input);
  const project = await getProjectOrThrow(projectId);
  const target: ProjectTarget = { id: project.id, team: project.team };
  const staffed = await isCallerStaffed(projectId, caller.id);

  if (!canEditProject(caller, target, staffed)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'project_updated',
      resourceType: 'project',
      resourceId: projectId,
      result: 'denied'
    });
    throw new Error('Not permitted to edit this project');
  }

  if (parsed.team && parsed.team !== project.team && caller.role !== 'ADMIN') {
    throw new Error("Only an ADMIN can change a project's team");
  }

  const [updated] = await db
    .update(projects)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_updated',
    resourceType: 'project',
    resourceId: projectId,
    result: 'success',
    metadata: { fields: Object.keys(parsed) }
  });

  revalidatePath('/dashboard/projects');
  revalidatePath(`/dashboard/projects/${projectId}`);
  return updated;
}

export async function assignStaffToProject(projectId: string, input: ProjectStaffAssignmentInput) {
  const caller = await requireActiveEmployee();
  const parsed = projectStaffAssignmentSchema.parse(input);
  const project = await getProjectOrThrow(projectId);
  const target: ProjectTarget = { id: project.id, team: project.team };

  if (!canManageProjectStaff(caller, target)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'project_staff_assigned',
      resourceType: 'project',
      resourceId: projectId,
      result: 'denied'
    });
    throw new Error('Not permitted to manage staff on this project');
  }

  await db
    .insert(projectStaff)
    .values({ projectId, employeeId: parsed.employeeId })
    .onConflictDoNothing({ target: [projectStaff.projectId, projectStaff.employeeId] });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_staff_assigned',
    resourceType: 'project',
    resourceId: projectId,
    result: 'success',
    metadata: { employeeId: parsed.employeeId }
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function removeStaffFromProject(
  projectId: string,
  input: ProjectStaffAssignmentInput
) {
  const caller = await requireActiveEmployee();
  const parsed = projectStaffAssignmentSchema.parse(input);
  const project = await getProjectOrThrow(projectId);
  const target: ProjectTarget = { id: project.id, team: project.team };

  if (!canManageProjectStaff(caller, target)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'project_staff_removed',
      resourceType: 'project',
      resourceId: projectId,
      result: 'denied'
    });
    throw new Error('Not permitted to manage staff on this project');
  }

  await db
    .delete(projectStaff)
    .where(
      and(eq(projectStaff.projectId, projectId), eq(projectStaff.employeeId, parsed.employeeId))
    );

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_staff_removed',
    resourceType: 'project',
    resourceId: projectId,
    result: 'success',
    metadata: { employeeId: parsed.employeeId }
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function addMilestone(projectId: string, input: AddMilestoneInput) {
  const caller = await requireActiveEmployee();
  const parsed = addMilestoneSchema.parse(input);
  const project = await getProjectOrThrow(projectId);
  const target: ProjectTarget = { id: project.id, team: project.team };
  const staffed = await isCallerStaffed(projectId, caller.id);

  if (!canEditProject(caller, target, staffed)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'project_milestone_added',
      resourceType: 'project',
      resourceId: projectId,
      result: 'denied'
    });
    throw new Error('Not permitted to add a milestone to this project');
  }

  const [created] = await db
    .insert(projectMilestones)
    .values({ projectId, title: parsed.title, dueDate: parsed.dueDate ?? null })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_milestone_added',
    resourceType: 'project',
    resourceId: projectId,
    result: 'success',
    metadata: { milestoneId: created.id }
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  return created;
}

export async function completeMilestone(milestoneId: string) {
  const caller = await requireActiveEmployee();

  const [milestone] = await db
    .select()
    .from(projectMilestones)
    .where(eq(projectMilestones.id, milestoneId))
    .limit(1);
  if (!milestone) throw new Error('Milestone not found');

  const project = await getProjectOrThrow(milestone.projectId);
  const target: ProjectTarget = { id: project.id, team: project.team };
  const staffed = await isCallerStaffed(project.id, caller.id);

  if (!canEditProject(caller, target, staffed)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'project_milestone_completed',
      resourceType: 'project',
      resourceId: project.id,
      result: 'denied'
    });
    throw new Error('Not permitted to complete this milestone');
  }

  const [updated] = await db
    .update(projectMilestones)
    .set({ completedAt: new Date(), updatedAt: new Date() })
    .where(eq(projectMilestones.id, milestoneId))
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'project_milestone_completed',
    resourceType: 'project',
    resourceId: project.id,
    result: 'success',
    metadata: { milestoneId }
  });

  revalidatePath(`/dashboard/projects/${project.id}`);
  return updated;
}
