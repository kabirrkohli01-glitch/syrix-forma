import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { clientStaff, clients, employees } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { assignStaffToClient, createClient, removeStaffFromClient, updateClient } = await import(
  '@/features/clients/actions'
);

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAlphaEmployee = `test_${runId}_alpha_employee`;
const clerkIdAlphaLead = `test_${runId}_alpha_lead`;
const clerkIdBetaLead = `test_${runId}_beta_lead`;

let alphaEmployeeId: string;
const createdClientIds: string[] = [];

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

  alphaEmployeeId = alphaEmployee.id;
});

afterAll(async () => {
  for (const id of createdClientIds) {
    await db.delete(clientStaff).where(eq(clientStaff.clientId, id));
    await db.delete(clients).where(eq(clients.id, id));
  }
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaEmployee));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaLead));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdBetaLead));
});

describe('createClient', () => {
  it('rejects a plain EMPLOYEE from creating a client', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    await expect(createClient({ name: 'Should fail' })).rejects.toThrow();
  });

  it('lets a TEAM_LEAD create a client, defaulting team to their own', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createClient({ name: 'Alpha Client', serviceLine: 'Advisory' });
    createdClientIds.push(created.id);

    expect(created.team).toBe('alpha');
    expect(created.status).toBe('active');
  });

  it('rejects a TEAM_LEAD creating a client outside their own team', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    await expect(createClient({ name: 'Wrong team client', team: 'beta' })).rejects.toThrow();
  });
});

describe('updateClient', () => {
  it('lets a TEAM_LEAD edit a same-team client without being staffed', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createClient({ name: 'Editable Client' });
    createdClientIds.push(created.id);

    const updated = await updateClient(created.id, { name: 'Edited Client Name' });
    expect(updated.name).toBe('Edited Client Name');
  });

  it('rejects a TEAM_LEAD editing a different-team client', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdBetaLead });
    const created = await (async () => {
      mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
      const c = await createClient({ name: 'Alpha-only Client' });
      createdClientIds.push(c.id);
      return c;
    })();

    mockAuth.mockResolvedValue({ userId: clerkIdBetaLead });
    await expect(updateClient(created.id, { name: 'Should fail' })).rejects.toThrow();
  });
});

describe('assignStaffToClient / removeStaffFromClient', () => {
  it('lets a TEAM_LEAD staff and unstaff an EMPLOYEE on a same-team client', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createClient({ name: 'Staffable Client' });
    createdClientIds.push(created.id);

    await assignStaffToClient(created.id, { employeeId: alphaEmployeeId });
    const [staffedRow] = await db
      .select()
      .from(clientStaff)
      .where(eq(clientStaff.clientId, created.id));
    expect(staffedRow?.employeeId).toBe(alphaEmployeeId);

    await removeStaffFromClient(created.id, { employeeId: alphaEmployeeId });
    const remaining = await db.select().from(clientStaff).where(eq(clientStaff.clientId, created.id));
    expect(remaining).toHaveLength(0);
  });

  it('rejects a plain EMPLOYEE from managing staff even if staffed on the client', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const created = await createClient({ name: 'Staff-managed Client' });
    createdClientIds.push(created.id);
    await assignStaffToClient(created.id, { employeeId: alphaEmployeeId });

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    await expect(
      assignStaffToClient(created.id, { employeeId: alphaEmployeeId })
    ).rejects.toThrow();
  });
});
