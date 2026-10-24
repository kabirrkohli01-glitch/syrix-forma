import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { conversations, employees } from '@/lib/db/schema';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';

function asCaller(id: string): ActiveEmployee {
  return {
    id,
    clerkUserId: `caller_${id}`,
    name: 'Caller',
    displayName: 'Caller',
    email: 'caller@example.test',
    role: 'EMPLOYEE',
    team: null,
    managerId: null,
    financeAccess: false,
    hrAdmin: false
  };
}

// Only auth() is faked — everything downstream (permission checks, DB writes) runs for real
// against the dev database, same convention as tests/clients/client-notes-actions.test.ts.
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { createConversation, getMessages, leaveConversation, markConversationRead, sendMessage } =
  await import('@/features/chat/actions');
const { requestAttachmentUpload } = await import('@/features/chat/attachments-actions');
const { isConversationParticipant } = await import('@/lib/permissions/chat-access');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAlpha = `test_${runId}_alpha`;
const clerkIdBeta = `test_${runId}_beta`;
const clerkIdGamma = `test_${runId}_gamma`;
const clerkIdAdmin = `test_${runId}_admin`;

let alphaId: string;
let betaId: string;
let gammaId: string;

beforeAll(async () => {
  const rows = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIdAlpha,
        name: 'Alpha',
        email: `${clerkIdAlpha}@example.test`,
        role: 'EMPLOYEE',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIdBeta,
        name: 'Beta',
        email: `${clerkIdBeta}@example.test`,
        role: 'EMPLOYEE',
        team: 'beta',
        status: 'active'
      },
      {
        clerkUserId: clerkIdGamma,
        name: 'Gamma',
        email: `${clerkIdGamma}@example.test`,
        role: 'EMPLOYEE',
        team: 'gamma',
        status: 'active'
      },
      {
        clerkUserId: clerkIdAdmin,
        name: 'Admin',
        email: `${clerkIdAdmin}@example.test`,
        role: 'ADMIN',
        team: null,
        status: 'active'
      }
    ])
    .returning();

  alphaId = rows.find((r) => r.clerkUserId === clerkIdAlpha)!.id;
  betaId = rows.find((r) => r.clerkUserId === clerkIdBeta)!.id;
  gammaId = rows.find((r) => r.clerkUserId === clerkIdGamma)!.id;
});

afterAll(async () => {
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlpha));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdBeta));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdGamma));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAdmin));
});

describe('Team Chat authorization', () => {
  it('rejects a non-participant reading, sending, marking read, or attaching a file — including an ADMIN', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });
    const { id: conversationId } = await createConversation({
      type: 'dm',
      participantEmployeeIds: [betaId]
    });

    mockAuth.mockResolvedValue({ userId: clerkIdGamma });
    await expect(getMessages(conversationId)).rejects.toThrow();
    await expect(sendMessage({ conversationId, body: 'Not allowed' })).rejects.toThrow();
    await expect(markConversationRead(conversationId)).rejects.toThrow();
    await expect(
      requestAttachmentUpload({
        conversationId,
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100
      })
    ).rejects.toThrow();

    // Platform administration doesn't imply standing access to someone else's private
    // conversation (docs/permissions-matrix.md) — an ADMIN who was never added is rejected too.
    mockAuth.mockResolvedValue({ userId: clerkIdAdmin });
    await expect(getMessages(conversationId)).rejects.toThrow();

    await db.delete(conversations).where(eq(conversations.id, conversationId));
  });

  it('lets both participants read and send in a DM, and reuses an existing DM instead of duplicating it', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });
    const first = await createConversation({ type: 'dm', participantEmployeeIds: [betaId] });
    expect(first.reused).toBe(false);

    const second = await createConversation({ type: 'dm', participantEmployeeIds: [betaId] });
    expect(second.reused).toBe(true);
    expect(second.id).toBe(first.id);

    mockAuth.mockResolvedValue({ userId: clerkIdBeta });
    const sent = await sendMessage({ conversationId: first.id, body: 'Hello from Beta' });
    expect(sent.body).toBe('Hello from Beta');

    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });
    const messages = await getMessages(first.id);
    expect(messages.some((m) => m.body === 'Hello from Beta')).toBe(true);

    await db.delete(conversations).where(eq(conversations.id, first.id));
  });

  it('creates a group conversation with every named participant able to read it', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });
    const group = await createConversation({
      type: 'group',
      participantEmployeeIds: [betaId, gammaId],
      name: 'Test group'
    });

    for (const participantId of [alphaId, betaId, gammaId]) {
      expect(await isConversationParticipant(asCaller(participantId), group.id)).toBe(true);
    }

    await db.delete(conversations).where(eq(conversations.id, group.id));
  });

  it('rejects a non-participant leaving a conversation', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });
    const { id: conversationId } = await createConversation({
      type: 'dm',
      participantEmployeeIds: [betaId]
    });

    mockAuth.mockResolvedValue({ userId: clerkIdGamma });
    await expect(leaveConversation(conversationId)).rejects.toThrow();

    await db.delete(conversations).where(eq(conversations.id, conversationId));
  });

  it('removes only the caller from a group, leaving the others able to read it', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });
    const group = await createConversation({
      type: 'group',
      participantEmployeeIds: [betaId, gammaId],
      name: 'Leaving test group'
    });

    await leaveConversation(group.id);

    expect(await isConversationParticipant(asCaller(alphaId), group.id)).toBe(false);
    expect(await isConversationParticipant(asCaller(betaId), group.id)).toBe(true);
    expect(await isConversationParticipant(asCaller(gammaId), group.id)).toBe(true);

    await db.delete(conversations).where(eq(conversations.id, group.id));
  });

  it('deletes the conversation once the last participant leaves', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });
    const { id: conversationId } = await createConversation({
      type: 'dm',
      participantEmployeeIds: [betaId]
    });

    mockAuth.mockResolvedValue({ userId: clerkIdBeta });
    await leaveConversation(conversationId);
    mockAuth.mockResolvedValue({ userId: clerkIdAlpha });
    await leaveConversation(conversationId);

    const [remaining] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    expect(remaining).toBeUndefined();
  });
});
