import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { setWorkStatus } = await import('@/features/teams/actions');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAlpha = `test_${runId}_alpha`;
const clerkIdBeta = `test_${runId}_beta`;

let alphaId: string;
let betaId: string;

beforeAll(async () => {
  const rows = await db
    .insert(employees)
    .values([
      { clerkUserId: clerkIdAlpha, name: 'Alpha', email: `${clerkIdAlpha}@example.test`, role: 'EMPLOYEE', team: 'alpha', status: 'active' },
      { clerkUserId: clerkIdBeta, name: 'Beta', email: `${clerkIdBeta}@example.test`, role: 'MANAGER', team: 'beta', status: 'active' }
    ])
    .returning();

  alphaId = rows.find((r) => r.clerkUserId === clerkIdAlpha)!.id;
  betaId = rows.find((r) => r.clerkUserId === clerkIdBeta)!.id;
});

afterAll(async () => {
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlpha));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdBeta));
});

describe('setWorkStatus', () => {
  it('defaults a new employee to logged_off', async () => {
    const [row] = await db.select().from(employees).where(eq(employees.id, alphaId));
    expect(row.workStatus).toBe('logged_off');
    expect(row.workStatusChangedAt).toBeNull();
  });

  it('sets only the caller\'s own status, stamping workStatusChangedAt', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });
    await setWorkStatus({ status: 'working' });

    const [alphaRow] = await db.select().from(employees).where(eq(employees.id, alphaId));
    expect(alphaRow.workStatus).toBe('working');
    expect(alphaRow.workStatusChangedAt).not.toBeNull();

    const [betaRow] = await db.select().from(employees).where(eq(employees.id, betaId));
    expect(betaRow.workStatus).toBe('logged_off');
  });

  it('every role can set their own status — no permission tier beyond being an active employee', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdBeta });
    await setWorkStatus({ status: 'on_break' });

    const [betaRow] = await db.select().from(employees).where(eq(employees.id, betaId));
    expect(betaRow.workStatus).toBe('on_break');
  });

  it('rejects an invalid status value', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });
    // @ts-expect-error deliberately invalid input to verify server-side validation
    await expect(setWorkStatus({ status: 'on_holiday' })).rejects.toThrow();
  });
});
