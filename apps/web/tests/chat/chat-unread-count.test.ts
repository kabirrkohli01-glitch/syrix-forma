import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { conversationParticipants, employees } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { createConversation, markConversationRead, sendMessage } = await import('@/features/chat/actions');
const { countUnreadConversationsForEmployee } = await import('@/features/chat/utils/queries');

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
      { clerkUserId: clerkIdBeta, name: 'Beta', email: `${clerkIdBeta}@example.test`, role: 'EMPLOYEE', team: 'alpha', status: 'active' }
    ])
    .returning();
  alphaId = rows.find((r) => r.clerkUserId === clerkIdAlpha)!.id;
  betaId = rows.find((r) => r.clerkUserId === clerkIdBeta)!.id;
});

afterAll(async () => {
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlpha));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdBeta));
});

describe('countUnreadConversationsForEmployee', () => {
  it('counts a conversation as unread once a message postdates the participant’s last read receipt, and 0 again after marking read', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });
    const { id: conversationId } = await createConversation({ type: 'dm', participantEmployeeIds: [betaId] });
    await expect(countUnreadConversationsForEmployee(betaId)).resolves.toBe(0);

    const { createdAt: messageCreatedAt } = await sendMessage({ conversationId, body: `Hello ${runId}` });

    // Backdate Beta's read receipt relative to the message row's own DB-assigned timestamp
    // (never comparing an app-clock Date() against a DB-clock defaultNow() value) so the
    // assertion can't flake from clock skew between this machine and the database server.
    await db
      .update(conversationParticipants)
      .set({ lastReadAt: new Date(messageCreatedAt.getTime() - 1000) })
      .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.employeeId, betaId)));

    await expect(countUnreadConversationsForEmployee(betaId)).resolves.toBe(1);
    // The sender's own message never counts as their own unread conversation.
    await expect(countUnreadConversationsForEmployee(alphaId)).resolves.toBe(0);

    mockAuth.mockResolvedValue({ userId: clerkIdBeta });
    await markConversationRead(conversationId);
    await expect(countUnreadConversationsForEmployee(betaId)).resolves.toBe(0);
  });

  it('treats a participant who has never read the conversation as unread once any message exists', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });
    const { id: conversationId } = await createConversation({ type: 'dm', participantEmployeeIds: [betaId] });
    await sendMessage({ conversationId, body: `Never read ${runId}` });

    await db
      .update(conversationParticipants)
      .set({ lastReadAt: null })
      .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.employeeId, betaId)));

    await expect(countUnreadConversationsForEmployee(betaId)).resolves.toBe(1);
  });

  it('returns 0 for an employee with no conversations', async () => {
    await expect(countUnreadConversationsForEmployee('00000000-0000-0000-0000-000000000000')).resolves.toBe(0);
  });
});
