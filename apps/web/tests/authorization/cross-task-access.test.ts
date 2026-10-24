import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees, tasks } from '@/lib/db/schema';

// Only `auth()` is faked here — everything downstream runs for real against the dev database.
// This is the build plan Phase 2's required test, the Task analogue of Phase 1's
// cross-employee-access test: cross-team/cross-scope access attempts via a raw API call.
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));

const { GET } = await import('@/app/api/tasks/[id]/route');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAlphaEmployee = `test_${runId}_alpha_employee`;
const clerkIdAlphaEmployee2 = `test_${runId}_alpha_employee2`;
const clerkIdAlphaLead = `test_${runId}_alpha_lead`;
const clerkIdBetaLead = `test_${runId}_beta_lead`;
const clerkIdManager = `test_${runId}_manager`;
const clerkIdSecurityAdmin = `test_${runId}_security_admin`;

let alphaEmployeeId: string;
let alphaTaskId: string; // assigned to alphaEmployeeId
let betaTaskId: string; // assigned to nobody, team beta

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
    clerkUserId: clerkIdAlphaEmployee2,
    name: 'Alpha Employee 2',
    email: `${clerkIdAlphaEmployee2}@example.test`,
    role: 'EMPLOYEE',
    team: 'alpha',
    status: 'active'
  });
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
  await db.insert(employees).values({
    clerkUserId: clerkIdManager,
    name: 'Test Manager',
    email: `${clerkIdManager}@example.test`,
    role: 'MANAGER',
    team: 'alpha',
    status: 'active'
  });
  await db.insert(employees).values({
    clerkUserId: clerkIdSecurityAdmin,
    name: 'Test Security Admin',
    email: `${clerkIdSecurityAdmin}@example.test`,
    role: 'SECURITY_ADMIN',
    team: null,
    status: 'active'
  });

  alphaEmployeeId = alphaEmployee.id;

  const [alphaTask] = await db
    .insert(tasks)
    .values({ title: 'Alpha task', team: 'alpha', assigneeId: alphaEmployeeId })
    .returning();
  const [betaTask] = await db
    .insert(tasks)
    .values({ title: 'Beta task', team: 'beta', assigneeId: null })
    .returning();

  alphaTaskId = alphaTask.id;
  betaTaskId = betaTask.id;
});

afterAll(async () => {
  await db.delete(tasks).where(eq(tasks.id, alphaTaskId));
  await db.delete(tasks).where(eq(tasks.id, betaTaskId));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaEmployee));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaEmployee2));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaLead));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdBetaLead));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdManager));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdSecurityAdmin));
});

function getTask(id: string) {
  return GET(new Request(`http://localhost/api/tasks/${id}`), {
    params: Promise.resolve({ id })
  });
}

describe('GET /api/tasks/[id] — cross-task authorization', () => {
  it('rejects an EMPLOYEE reading a task assigned to a teammate', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee2 });
    const res = await getTask(alphaTaskId);
    expect(res.status).toBe(403);
  });

  it('allows the assignee to read their own task', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const res = await getTask(alphaTaskId);
    expect(res.status).toBe(200);
  });

  it('rejects a TEAM_LEAD reading a different team\'s task', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const res = await getTask(betaTaskId);
    expect(res.status).toBe(403);
  });

  it('allows a TEAM_LEAD to read a same-team task, including an unassigned one', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdBetaLead });
    const res = await getTask(betaTaskId);
    expect(res.status).toBe(200);
  });

  it('allows a MANAGER to read any team\'s task (cross-team scope)', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdManager });
    const res = await getTask(betaTaskId);
    expect(res.status).toBe(200);
  });

  it('rejects a SECURITY_ADMIN reading any task (scoped away from business data)', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdSecurityAdmin });
    const res = await getTask(alphaTaskId);
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await getTask(alphaTaskId);
    expect(res.status).toBe(403);
  });
});
