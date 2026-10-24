import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { clientStaff, clients, employees } from '@/lib/db/schema';

// Only `auth()` is faked here — everything downstream runs for real against the dev database.
// This is the build plan Phase 2's explicit requirement: "cross-client access attempts via a
// raw API call."
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));

const { GET } = await import('@/app/api/clients/[id]/route');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAlphaEmployee = `test_${runId}_alpha_employee`;
const clerkIdAlphaEmployeeUnstaffed = `test_${runId}_alpha_employee_unstaffed`;
const clerkIdAlphaLead = `test_${runId}_alpha_lead`;
const clerkIdBetaLead = `test_${runId}_beta_lead`;
const clerkIdManager = `test_${runId}_manager`;
const clerkIdSecurityAdmin = `test_${runId}_security_admin`;

let alphaEmployeeId: string;
let alphaClientId: string;
let betaClientId: string;

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
    clerkUserId: clerkIdAlphaEmployeeUnstaffed,
    name: 'Alpha Employee (unstaffed)',
    email: `${clerkIdAlphaEmployeeUnstaffed}@example.test`,
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

  const [alphaClient] = await db.insert(clients).values({ name: 'Alpha Client', team: 'alpha' }).returning();
  const [betaClient] = await db.insert(clients).values({ name: 'Beta Client', team: 'beta' }).returning();
  alphaClientId = alphaClient.id;
  betaClientId = betaClient.id;

  await db.insert(clientStaff).values({ clientId: alphaClientId, employeeId: alphaEmployeeId });
});

afterAll(async () => {
  await db.delete(clientStaff).where(eq(clientStaff.clientId, alphaClientId));
  await db.delete(clients).where(eq(clients.id, alphaClientId));
  await db.delete(clients).where(eq(clients.id, betaClientId));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaEmployee));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaEmployeeUnstaffed));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaLead));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdBetaLead));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdManager));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdSecurityAdmin));
});

function getClient(id: string) {
  return GET(new Request(`http://localhost/api/clients/${id}`), {
    params: Promise.resolve({ id })
  });
}

describe('GET /api/clients/[id] — cross-client authorization', () => {
  it('allows an EMPLOYEE staffed on the client to read it', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const res = await getClient(alphaClientId);
    expect(res.status).toBe(200);
  });

  it('rejects an EMPLOYEE on the same team but not staffed on the client', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployeeUnstaffed });
    const res = await getClient(alphaClientId);
    expect(res.status).toBe(403);
  });

  it('rejects a TEAM_LEAD reading a different team\'s client', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const res = await getClient(betaClientId);
    expect(res.status).toBe(403);
  });

  it('allows a TEAM_LEAD to read a same-team client without being personally staffed', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdBetaLead });
    const res = await getClient(betaClientId);
    expect(res.status).toBe(200);
  });

  it('allows a MANAGER to read any team\'s client (cross-team scope)', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdManager });
    const res = await getClient(betaClientId);
    expect(res.status).toBe(200);
  });

  it('rejects a SECURITY_ADMIN reading any client (scoped away from business data)', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdSecurityAdmin });
    const res = await getClient(alphaClientId);
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await getClient(alphaClientId);
    expect(res.status).toBe(403);
  });
});
