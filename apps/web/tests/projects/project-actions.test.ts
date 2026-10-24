import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { clients, employees, projectMilestones, projectStaff, projects } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const {
  addMilestone,
  assignStaffToProject,
  completeMilestone,
  createProject,
  removeStaffFromProject,
  updateProject
} = await import('@/features/projects/actions');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAlphaEmployee = `test_${runId}_alpha_employee`;
const clerkIdAlphaLead = `test_${runId}_alpha_lead`;
const clerkIdBetaLead = `test_${runId}_beta_lead`;

let alphaEmployeeId: string;
let alphaClientId: string;
const createdProjectIds: string[] = [];

beforeAll(async () => {
  const [alphaEmployee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdAlphaEmployee,
      name: 'Alpha Employee',
      email: `${clerkIdAlphaEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  await db.insert(employees).values({
    clerkUserId: clerkIdAlphaLead,
    name: 'Alpha Lead',
    email: `${clerkIdAlphaLead}@example.test`,
    role: 'TEAM_LEAD',
    team: 'alpha',
    status: 'active'
  });
  await db.insert(employees).values({
    clerkUserId: clerkIdBetaLead,
    name: 'Beta Lead',
    email: `${clerkIdBetaLead}@example.test`,
    role: 'TEAM_LEAD',
    team: 'beta',
    status: 'active'
  });
  const [alphaClient] = await db
    .insert(clients)
    .values({ name: 'Alpha Client', team: 'alpha' })
    .returning();

  alphaEmployeeId = alphaEmployee.id;
  alphaClientId = alphaClient.id;
});

afterAll(async () => {
  for (const id of createdProjectIds) {
    await db.delete(projectMilestones).where(eq(projectMilestones.projectId, id));
    await db.delete(projectStaff).where(eq(projectStaff.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
  await db.delete(clients).where(eq(clients.id, alphaClientId));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaEmployee));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaLead));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdBetaLead));
});

describe('createProject', () => {
  it('rejects a plain EMPLOYEE from creating a project', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    await expect(createProject({ clientId: alphaClientId, name: 'Should fail' })).rejects.toThrow();
  });

  it('lets a TEAM_LEAD create a project under an existing client, defaulting team', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createProject({ clientId: alphaClientId, name: 'Alpha Project' });
    createdProjectIds.push(created.id);

    expect(created.team).toBe('alpha');
    expect(created.clientId).toBe(alphaClientId);
    expect(created.status).toBe('active');
  });

  it('rejects creating a project under a nonexistent client', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    await expect(
      createProject({ clientId: '00000000-0000-0000-0000-000000000000', name: 'No client' })
    ).rejects.toThrow();
  });
});

// Project has no dedicated raw API route (its authorization shape is identical to Client's —
// see docs/permissions-matrix.md and the Phase 2 plan) — this exercises the same cross-team
// scoping directly against the Server Action instead of a route handler.
describe('updateProject — cross-team authorization', () => {
  it('lets a TEAM_LEAD edit a same-team project without being personally staffed', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createProject({ clientId: alphaClientId, name: 'Editable Project' });
    createdProjectIds.push(created.id);

    const updated = await updateProject(created.id, { name: 'Edited Project Name' });
    expect(updated.name).toBe('Edited Project Name');
  });

  it('rejects a TEAM_LEAD editing a different-team project', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createProject({ clientId: alphaClientId, name: 'Alpha-only Project' });
    createdProjectIds.push(created.id);

    mockAuth.mockResolvedValue({ userId: clerkIdBetaLead });
    await expect(updateProject(created.id, { name: 'Should fail' })).rejects.toThrow();
  });
});

describe('assignStaffToProject / removeStaffFromProject', () => {
  it('lets a TEAM_LEAD staff and unstaff an EMPLOYEE on a same-team project', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createProject({ clientId: alphaClientId, name: 'Staffable Project' });
    createdProjectIds.push(created.id);

    await assignStaffToProject(created.id, { employeeId: alphaEmployeeId });
    const [staffedRow] = await db
      .select()
      .from(projectStaff)
      .where(eq(projectStaff.projectId, created.id));
    expect(staffedRow?.employeeId).toBe(alphaEmployeeId);

    await removeStaffFromProject(created.id, { employeeId: alphaEmployeeId });
    const remaining = await db
      .select()
      .from(projectStaff)
      .where(eq(projectStaff.projectId, created.id));
    expect(remaining).toHaveLength(0);
  });

  it('rejects a plain EMPLOYEE from managing staff even if staffed on the project', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createProject({ clientId: alphaClientId, name: 'Staff-managed Project' });
    createdProjectIds.push(created.id);
    await assignStaffToProject(created.id, { employeeId: alphaEmployeeId });

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    await expect(
      assignStaffToProject(created.id, { employeeId: alphaEmployeeId })
    ).rejects.toThrow();
  });
});

describe('addMilestone / completeMilestone', () => {
  it('lets a TEAM_LEAD add and complete a milestone', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createProject({ clientId: alphaClientId, name: 'Milestone Project' });
    createdProjectIds.push(created.id);

    const milestone = await addMilestone(created.id, { title: 'Kickoff' });
    expect(milestone.completedAt).toBeNull();

    const completed = await completeMilestone(milestone.id);
    expect(completed.completedAt).not.toBeNull();
  });

  it('rejects a TEAM_LEAD adding a milestone to a different-team project', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createProject({ clientId: alphaClientId, name: 'Cross-team Milestone' });
    createdProjectIds.push(created.id);

    mockAuth.mockResolvedValue({ userId: clerkIdBetaLead });
    await expect(addMilestone(created.id, { title: 'Should fail' })).rejects.toThrow();
  });
});
