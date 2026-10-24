import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db/client';
import { clientStaff, clients, employees } from '@/lib/db/schema';
import { clientScopeCondition } from '@/features/clients/utils/scope';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';

// clientScopeCondition builds a real `exists()` subquery — nothing else in the test suite
// exercises it against a live database (the authorization tests hit canViewClient directly,
// a pure predicate, not this SQL). Runs the actual query to catch a malformed EXISTS/OR before
// the list page ships it.
const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAlphaStaffed = `test_${runId}_alpha_staffed`;

let alphaEmployeeId: string;
let staffedClientId: string; // team beta, but caller is staffed on it
let sameTeamClientId: string; // team alpha, caller not staffed
let unrelatedClientId: string; // team gamma, caller not staffed, not staffed

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

  const [staffedClient] = await db
    .insert(clients)
    .values({ name: 'Staffed Client (team beta)', team: 'beta' })
    .returning();
  const [sameTeamClient] = await db
    .insert(clients)
    .values({ name: 'Same-team Client (team alpha)', team: 'alpha' })
    .returning();
  const [unrelatedClient] = await db
    .insert(clients)
    .values({ name: 'Unrelated Client (team gamma)', team: 'gamma' })
    .returning();

  staffedClientId = staffedClient.id;
  sameTeamClientId = sameTeamClient.id;
  unrelatedClientId = unrelatedClient.id;

  await db.insert(clientStaff).values({ clientId: staffedClientId, employeeId: alphaEmployeeId });
});

afterAll(async () => {
  await db.delete(clientStaff).where(eq(clientStaff.clientId, staffedClientId));
  await db.delete(clients).where(eq(clients.id, staffedClientId));
  await db.delete(clients).where(eq(clients.id, sameTeamClientId));
  await db.delete(clients).where(eq(clients.id, unrelatedClientId));
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
    .select({ id: clients.id })
    .from(clients)
    .where(clientScopeCondition(caller));
  return new Set(
    rows
      .map((r) => r.id)
      .filter((id) => [staffedClientId, sameTeamClientId, unrelatedClientId].includes(id))
  );
}

describe('clientScopeCondition (real query)', () => {
  it('EMPLOYEE (own scope) sees only the client they are staffed on, regardless of team', async () => {
    const visible = await idsVisibleTo(employee({ role: 'EMPLOYEE' }));
    expect(visible.has(staffedClientId)).toBe(true);
    expect(visible.has(sameTeamClientId)).toBe(false);
    expect(visible.has(unrelatedClientId)).toBe(false);
  });

  it('TEAM_LEAD (team scope) sees same-team clients plus anything they are staffed on', async () => {
    const visible = await idsVisibleTo(employee({ role: 'TEAM_LEAD' }));
    expect(visible.has(sameTeamClientId)).toBe(true);
    expect(visible.has(staffedClientId)).toBe(true);
    expect(visible.has(unrelatedClientId)).toBe(false);
  });

  it('MANAGER (cross-team scope) sees every client with no WHERE restriction', async () => {
    const visible = await idsVisibleTo(employee({ role: 'MANAGER' }));
    expect(visible.has(sameTeamClientId)).toBe(true);
    expect(visible.has(staffedClientId)).toBe(true);
    expect(visible.has(unrelatedClientId)).toBe(true);
  });

  it('SECURITY_ADMIN (none scope) sees nothing', async () => {
    const visible = await idsVisibleTo(employee({ role: 'SECURITY_ADMIN', team: null }));
    expect(visible.size).toBe(0);
  });
});
