import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';

// Only `auth()` is faked here — there is no real Clerk session available in a test process.
// Everything downstream (the route handler, the DB-backed permission check, the real
// employees rows) runs for real against the dev database. This is the build plan Phase 1's
// required test: an EMPLOYEE trying to read another employee's record via a raw API call.
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));

const { GET } = await import('@/app/api/employees/[id]/route');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdA = `test_${runId}_a`;
const clerkIdB = `test_${runId}_b`;
const clerkIdAdmin = `test_${runId}_admin`;

let employeeAId: string;
let employeeBId: string;

beforeAll(async () => {
  const [a] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdA,
      name: 'Test Employee A',
      email: `${clerkIdA}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  const [b] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdB,
      name: 'Test Employee B',
      email: `${clerkIdB}@example.test`,
      role: 'EMPLOYEE',
      team: 'beta',
      status: 'active'
    })
    .returning();
  await db.insert(employees).values({
    clerkUserId: clerkIdAdmin,
    name: 'Test Admin',
    email: `${clerkIdAdmin}@example.test`,
    role: 'ADMIN',
    team: null,
    status: 'active'
  });

  employeeAId = a.id;
  employeeBId = b.id;
});

afterAll(async () => {
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdA));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdB));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAdmin));
});

function getEmployee(id: string) {
  return GET(new Request(`http://localhost/api/employees/${id}`), {
    params: Promise.resolve({ id })
  });
}

describe('GET /api/employees/[id] — cross-employee authorization', () => {
  it('rejects an EMPLOYEE reading a different employee record', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdA });
    const res = await getEmployee(employeeBId);
    expect(res.status).toBe(403);
  });

  it('allows an EMPLOYEE reading their own record', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdA });
    const res = await getEmployee(employeeAId);
    expect(res.status).toBe(200);
  });

  it('allows an ADMIN reading any employee record', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAdmin });
    const res = await getEmployee(employeeBId);
    expect(res.status).toBe(200);
  });

  it('rejects an unauthenticated request', async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await getEmployee(employeeBId);
    expect(res.status).toBe(403);
  });
});
