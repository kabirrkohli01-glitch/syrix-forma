import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';

// getEmployeeRow's lazy-provisioning fallback (lib/permissions/current-employee.ts) — added
// after a real signed-in Clerk user was found with zero rows in employees, because the
// `user.created` webhook that's supposed to create one can only ever fire once this app has a
// public URL Clerk's servers can reach, never true for plain localhost dev.
const mockAuth = vi.fn();
const mockCurrentUser = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
  currentUser: () => mockCurrentUser()
}));

const { getEmployeeRow } = await import('@/lib/permissions/current-employee');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkId = `test_${runId}_lazy_provision`;

afterAll(async () => {
  await db.delete(employees).where(eq(employees.clerkUserId, clerkId));
});

describe('getEmployeeRow — lazy provisioning', () => {
  it('creates a pending, no-role row for a signed-in Clerk user with no existing employees row', async () => {
    mockAuth.mockResolvedValue({ userId: clerkId });
    mockCurrentUser.mockResolvedValue({
      emailAddresses: [{ id: 'idn_1', emailAddress: `${clerkId}@example.test` }],
      primaryEmailAddressId: 'idn_1',
      firstName: 'Test',
      lastName: 'LazyProvision'
    });

    const row = await getEmployeeRow();

    expect(row).not.toBeNull();
    expect(row?.clerkUserId).toBe(clerkId);
    expect(row?.email).toBe(`${clerkId}@example.test`);
    expect(row?.name).toBe('Test LazyProvision');
    // The shared dev DB already has real employees in it, so this can never land as the "first
    // employee" here — that branch is exercised by the one real bootstrap event it's meant for,
    // not repeatable in a test without deleting real data.
    expect(row?.role).toBeNull();
    expect(row?.status).toBe('pending');
  });

  it('is idempotent — a second call for the same user returns the same row, no duplicate insert', async () => {
    mockAuth.mockResolvedValue({ userId: clerkId });

    const row = await getEmployeeRow();
    expect(row?.clerkUserId).toBe(clerkId);

    const rows = await db.select().from(employees).where(eq(employees.clerkUserId, clerkId));
    expect(rows).toHaveLength(1);
  });

  it('returns null for a signed-out request without ever calling currentUser', async () => {
    mockAuth.mockResolvedValue({ userId: null });
    mockCurrentUser.mockClear();

    const row = await getEmployeeRow();

    expect(row).toBeNull();
    expect(mockCurrentUser).not.toHaveBeenCalled();
  });
});
