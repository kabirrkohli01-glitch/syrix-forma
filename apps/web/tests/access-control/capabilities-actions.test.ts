import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { updateEmployeeCapabilities } = await import('@/features/access-control/actions');

// Step-up auth is bound to the session that passed the challenge, so these suites need a
// stable session id to both stage a step-up and then spend it.
const TEST_SESSION = 'sess_test_step_up';

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = {
  admin: `test_${runId}_admin`,
  securityAdmin: `test_${runId}_secadmin`,
  employee: `test_${runId}_employee`
};
const ids: Record<keyof typeof clerkIds, string> = { admin: '', securityAdmin: '', employee: '' };

async function grantStepUp(employeeId: string) {
  await db.update(employees).set({ stepUpVerifiedAt: new Date(), stepUpSessionId: TEST_SESSION }).where(eq(employees.id, employeeId));
}

beforeAll(async () => {
  const rows = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.admin,
        name: 'Admin',
        email: `${clerkIds.admin}@example.test`,
        role: 'ADMIN',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.securityAdmin,
        name: 'Security Admin',
        email: `${clerkIds.securityAdmin}@example.test`,
        role: 'SECURITY_ADMIN',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.employee,
        name: 'Employee',
        email: `${clerkIds.employee}@example.test`,
        role: 'EMPLOYEE',
        status: 'active'
      }
    ])
    .returning();

  ids.admin = rows.find((r) => r.clerkUserId === clerkIds.admin)!.id;
  ids.securityAdmin = rows.find((r) => r.clerkUserId === clerkIds.securityAdmin)!.id;
  ids.employee = rows.find((r) => r.clerkUserId === clerkIds.employee)!.id;

  await grantStepUp(ids.admin);
});

afterAll(async () => {
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIds.admin));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIds.securityAdmin));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIds.employee));
});

describe('updateEmployeeCapabilities', () => {
  it('rejects granting hrAdmin to a SECURITY_ADMIN, matching the wall enforced at read time', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.admin, sessionId: TEST_SESSION });

    await expect(
      updateEmployeeCapabilities(ids.securityAdmin, { hrAdmin: true, financeAccess: false })
    ).rejects.toThrow(/SECURITY_ADMIN/);

    const [row] = await db.select().from(employees).where(eq(employees.id, ids.securityAdmin));
    expect(row.hrAdmin).toBe(false);
  });

  it('rejects granting financeAccess to a SECURITY_ADMIN the same way', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.admin, sessionId: TEST_SESSION });

    await expect(
      updateEmployeeCapabilities(ids.securityAdmin, { hrAdmin: false, financeAccess: true })
    ).rejects.toThrow(/SECURITY_ADMIN/);

    const [row] = await db.select().from(employees).where(eq(employees.id, ids.securityAdmin));
    expect(row.financeAccess).toBe(false);
  });

  it('still allows granting capabilities to a plain EMPLOYEE', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.admin, sessionId: TEST_SESSION });

    await updateEmployeeCapabilities(ids.employee, { hrAdmin: true, financeAccess: false });

    const [row] = await db.select().from(employees).where(eq(employees.id, ids.employee));
    expect(row.hrAdmin).toBe(true);
  });
});
