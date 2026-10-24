import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { clientNotes, clientStaff, clients, employees } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { addClientNote, removeClientNote, updateClientNote } = await import('@/features/clients/notes-actions');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAlphaEmployee = `test_${runId}_alpha_employee`;
const clerkIdAlphaEmployee2 = `test_${runId}_alpha_employee2`;
const clerkIdBetaEmployee = `test_${runId}_beta_employee`;

let alphaClientId: string;

beforeAll(async () => {
  await db.insert(employees).values([
    {
      clerkUserId: clerkIdAlphaEmployee,
      name: 'Alpha Employee',
      email: `${clerkIdAlphaEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    },
    {
      clerkUserId: clerkIdAlphaEmployee2,
      name: 'Alpha Employee 2',
      email: `${clerkIdAlphaEmployee2}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    },
    {
      clerkUserId: clerkIdBetaEmployee,
      name: 'Beta Employee',
      email: `${clerkIdBetaEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'beta',
      status: 'active'
    }
  ]);

  const [client] = await db.insert(clients).values({ name: 'Note Test Client', team: 'alpha' }).returning();
  alphaClientId = client.id;

  // Client's "own" scope for an EMPLOYEE is staff membership, not team match (client-access.ts)
  // — alphaEmployee needs an explicit client_staff row to view/note this client at all.
  const [alphaEmployeeRow] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.clerkUserId, clerkIdAlphaEmployee))
    .limit(1);
  await db.insert(clientStaff).values({ clientId: alphaClientId, employeeId: alphaEmployeeRow.id });
});

afterAll(async () => {
  await db.delete(clients).where(eq(clients.id, alphaClientId));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaEmployee));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaEmployee2));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdBetaEmployee));
});

describe('client notes', () => {
  it('lets a same-team employee add a note, rejects a different-team employee, and gates edit/delete on authorship', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdBetaEmployee });
    await expect(addClientNote(alphaClientId, { body: 'Not allowed' })).rejects.toThrow();

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const note = await addClientNote(alphaClientId, { body: 'First note' });

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee2 });
    await expect(updateClientNote(note.id, { body: 'Hijacked' })).rejects.toThrow();
    await expect(removeClientNote(note.id)).rejects.toThrow();

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const edited = await updateClientNote(note.id, { body: 'Edited note' });
    expect(edited.body).toBe('Edited note');

    await removeClientNote(note.id);
    const [remaining] = await db.select().from(clientNotes).where(eq(clientNotes.id, note.id)).limit(1);
    expect(remaining).toBeUndefined();
  });
});
