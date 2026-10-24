import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';

/* ONE ASSISTANT, ONE CONVERSATION EACH.
 *
 * Everybody gets the same SYRIX AI and nobody gets anybody else's chat, settings
 * or pending actions. The server holds no transcript at all, so the part that
 * could go wrong is the part that IS held: the action proposals waiting for
 * approval, and each person's own preferences.
 *
 * These are the things that would have to break for one employee to reach
 * another's, asserted rather than assumed. Only `auth()` is faked — there is no
 * real Clerk session in a test process. The broker, the permission check and the
 * employees rows are all real.
 */
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: () => null }));
/* `revalidatePath` needs Next's per-request store, which does not exist outside
   a request. It is cache invalidation, not authorisation — nothing under test
   here depends on it. */
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { propose, getProposal, approve, deny } = await import('@/lib/ai/hub/actions');
const { getAiSettings, updateAiSettings } = await import('@/features/forma-ai/actions');
const { getCurrentEmployee } = await import('@/lib/permissions/current-employee');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdA = `test_${runId}_a`;
const clerkIdB = `test_${runId}_b`;

type Employee = NonNullable<Awaited<ReturnType<typeof getCurrentEmployee>>>;

let employeeA: Employee;
let employeeB: Employee;

async function asEmployee(clerkUserId: string): Promise<Employee> {
  mockAuth.mockResolvedValue({ userId: clerkUserId });
  const employee = await getCurrentEmployee();
  if (!employee) throw new Error(`Fixture employee ${clerkUserId} did not resolve.`);
  return employee;
}

beforeAll(async () => {
  for (const [clerkUserId, name] of [
    [clerkIdA, 'Test AI User A'],
    [clerkIdB, 'Test AI User B']
  ]) {
    await db.insert(employees).values({
      clerkUserId: clerkUserId!,
      name: name!,
      email: `${clerkUserId}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    });
  }

  employeeA = await asEmployee(clerkIdA);
  employeeB = await asEmployee(clerkIdB);
});

afterAll(async () => {
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdA));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdB));
});

describe('a pending action belongs to the person who asked for it', () => {
  async function proposalFromA() {
    return propose(
      employeeA,
      'hub.task.create',
      { title: `Isolation probe ${runId}`, priority: 'low' },
      'Asked for in a test.'
    );
  }

  it('is readable by its owner', async () => {
    const proposal = await proposalFromA();
    expect(getProposal(proposal.id, employeeA)?.id).toBe(proposal.id);
  });

  /* The card is server-held precisely so the browser cannot supply its own
     payload. Holding it is only worth anything if the id alone is not enough. */
  it('is invisible to anybody else, even holding its id', async () => {
    const proposal = await proposalFromA();
    expect(getProposal(proposal.id, employeeB)).toBeNull();
  });

  it('cannot be approved by anybody else', async () => {
    const proposal = await proposalFromA();
    await expect(approve(proposal.id, employeeB)).rejects.toThrow();

    /* And the refusal must not have consumed it. */
    expect(getProposal(proposal.id, employeeA)?.id).toBe(proposal.id);
  });

  it('cannot be denied by anybody else', async () => {
    const proposal = await proposalFromA();
    await deny(proposal.id, employeeB);
    expect(getProposal(proposal.id, employeeA)?.id).toBe(proposal.id);
  });

  it('is gone for everyone once its owner denies it', async () => {
    const proposal = await proposalFromA();
    await deny(proposal.id, employeeA);
    expect(getProposal(proposal.id, employeeA)).toBeNull();
    expect(getProposal(proposal.id, employeeB)).toBeNull();
  });
});

describe('preferences are the caller’s own', () => {
  /* `updateAiSettings` takes no employee id and must never grow one: an action
     that accepted one would be an action somebody could use to change a
     colleague's settings. This asserts the behaviour that shape produces. */
  it('writes to the signed-in employee and nobody else', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdA });
    await updateAiSettings({ language: 'en', hubAccess: false });

    mockAuth.mockResolvedValue({ userId: clerkIdB });
    const forB = await getAiSettings();
    expect(forB.hubAccess).toBe(true);

    mockAuth.mockResolvedValue({ userId: clerkIdA });
    const forA = await getAiSettings();
    expect(forA.hubAccess).toBe(false);
  });
});

describe('nothing about a conversation is written down', () => {
  /* The claim the interface makes to its users, kept as a test because it is a
     property of a file rather than of a function: the store holds the transcript
     in memory and a new chat is meant to destroy it irreversibly. A `localStorage`
     call added here would survive review and quietly make that false. */
  it('the conversation store touches no browser storage', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('features/forma-ai/store/conversation.tsx', 'utf8');

    /* Comments are stripped first. The file's own header explains at length that
       it touches none of these, and a check that the words are absent would fail
       on the sentence promising they are. */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    expect(code).not.toMatch(/\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/);
  });
});
