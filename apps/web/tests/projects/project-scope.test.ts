import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db/client';
import { clients, employees, projectStaff, projects } from '@/lib/db/schema';
import { projectScopeCondition } from '@/features/projects/utils/scope';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';

// Same reasoning as tests/clients/client-scope.test.ts: projectScopeCondition builds a real
// EXISTS subquery that nothing else in the suite exercises against a live database.
const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAlphaStaffed = `test_${runId}_alpha_staffed`;

let alphaEmployeeId: string;
let clientId: string;
let staffedProjectId: string; // team beta, but caller is staffed on it
let sameTeamProjectId: string; // team alpha, caller not staffed
let unrelatedProjectId: string; // team gamma, caller not staffed

beforeAll(async () => {
  const [alphaEmployee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdAlphaStaffed,
      name: 'Alpha Staffed Employee',
      email: `${clerkIdAlphaStaffed}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  alphaEmployeeId = alphaEmployee.id;

  const [client] = await db
    .insert(clients)
    .values({ name: 'Scope Test Client', team: 'alpha' })
    .returning();
  clientId = client.id;

  const [staffedProject] = await db
    .insert(projects)
    .values({ clientId, name: 'Staffed Project (team beta)', team: 'beta' })
    .returning();
  const [sameTeamProject] = await db
    .insert(projects)
    .values({ clientId, name: 'Same-team Project (team alpha)', team: 'alpha' })
    .returning();
  const [unrelatedProject] = await db
    .insert(projects)
    .values({ clientId, name: 'Unrelated Project (team gamma)', team: 'gamma' })
    .returning();

  staffedProjectId = staffedProject.id;
  sameTeamProjectId = sameTeamProject.id;
  unrelatedProjectId = unrelatedProject.id;

  await db
    .insert(projectStaff)
    .values({ projectId: staffedProjectId, employeeId: alphaEmployeeId });
});

afterAll(async () => {
  await db.delete(projectStaff).where(eq(projectStaff.projectId, staffedProjectId));
  await db.delete(projects).where(eq(projects.id, staffedProjectId));
  await db.delete(projects).where(eq(projects.id, sameTeamProjectId));
  await db.delete(projects).where(eq(projects.id, unrelatedProjectId));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaStaffed));
});

function employee(overrides: Partial<ActiveEmployee>): ActiveEmployee {
  return {
    id: alphaEmployeeId,
    clerkUserId: clerkIdAlphaStaffed,
    name: 'Test',
    displayName: 'Test',
    email: 'test@example.test',
    role: 'EMPLOYEE',
    team: 'alpha',
    managerId: null,
    financeAccess: false,
    hrAdmin: false,
    ...overrides
  };
}

async function idsVisibleTo(caller: ActiveEmployee): Promise<Set<string>> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(projectScopeCondition(caller));
  return new Set(
    rows
      .map((r) => r.id)
      .filter((id) => [staffedProjectId, sameTeamProjectId, unrelatedProjectId].includes(id))
  );
}

describe('projectScopeCondition (real query)', () => {
  it('EMPLOYEE (own scope) sees only the project they are staffed on, regardless of team', async () => {
    const visible = await idsVisibleTo(employee({ role: 'EMPLOYEE' }));
    expect(visible.has(staffedProjectId)).toBe(true);
    expect(visible.has(sameTeamProjectId)).toBe(false);
    expect(visible.has(unrelatedProjectId)).toBe(false);
  });

  it('TEAM_LEAD (team scope) sees same-team projects plus anything they are staffed on', async () => {
    const visible = await idsVisibleTo(employee({ role: 'TEAM_LEAD' }));
    expect(visible.has(sameTeamProjectId)).toBe(true);
    expect(visible.has(staffedProjectId)).toBe(true);
    expect(visible.has(unrelatedProjectId)).toBe(false);
  });

  it('MANAGER (cross-team scope) sees every project with no WHERE restriction', async () => {
    const visible = await idsVisibleTo(employee({ role: 'MANAGER' }));
    expect(visible.has(sameTeamProjectId)).toBe(true);
    expect(visible.has(staffedProjectId)).toBe(true);
    expect(visible.has(unrelatedProjectId)).toBe(true);
  });

  it('SECURITY_ADMIN (none scope) sees nothing', async () => {
    const visible = await idsVisibleTo(employee({ role: 'SECURITY_ADMIN', team: null }));
    expect(visible.size).toBe(0);
  });
});
