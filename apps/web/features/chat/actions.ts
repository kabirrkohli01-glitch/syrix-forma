'use server';

import { and, count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { conversationParticipants, conversations, messages } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { isConversationParticipant } from '@/lib/permissions/chat-access';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { ExpectedChatError, throwSanitizedChatError } from './utils/errors';
import { findExistingDmConversation, getConversationMessages, listConversationsForEmployee } from './utils/queries';
import {
  createConversationSchema,
  sendMessageSchema,
  type CreateConversationInput,
  type SendMessageInput
} from './utils/schemas';

export async function getMyConversations() {
  const caller = await requireActiveEmployee();
  try {
    return await listConversationsForEmployee(caller.id);
  } catch (err) {
    throwSanitizedChatError(err, caller);
  }
}

export async function getMessages(conversationId: string, before?: Date) {
  const caller = await requireActiveEmployee();
  try {
    if (!(await isConversationParticipant(caller, conversationId))) {
      throw new ExpectedChatError('Not permitted to view this conversation');
    }
    return await getConversationMessages(conversationId, before);
  } catch (err) {
    throwSanitizedChatError(err, caller);
  }
}

/**
 * Every role can start a conversation — Team Chat has no create-time role gate, only the
 * participant-only read/write gate that applies once it exists (docs/permissions-matrix.md).
 * DMs are deduplicated: starting a second "conversation" with someone you already have a DM
 * with reopens the existing one instead of creating a parallel thread.
 */
export async function createConversation(input: CreateConversationInput) {
  const caller = await requireActiveEmployee();
  try {
    const parsed = createConversationSchema.parse(input);

    const otherParticipantIds = [...new Set(parsed.participantEmployeeIds)].filter((id) => id !== caller.id);
    if (otherParticipantIds.length === 0) {
      throw new ExpectedChatError('A conversation needs at least one other participant');
    }

    if (parsed.type === 'dm') {
      if (otherParticipantIds.length !== 1) {
        throw new ExpectedChatError('A DM must have exactly one other participant');
      }
      const existing = await findExistingDmConversation(caller.id, otherParticipantIds[0]);
      if (existing) return { id: existing, reused: true };
    }

    const participantIds = [caller.id, ...otherParticipantIds];

    const created = await db.transaction(async (tx) => {
      const [conversation] = await tx
        .insert(conversations)
        .values({ type: parsed.type, name: parsed.type === 'group' ? parsed.name ?? null : null, createdByEmployeeId: caller.id })
        .returning();

      await tx.insert(conversationParticipants).values(
        participantIds.map((employeeId) => ({ conversationId: conversation.id, employeeId, lastReadAt: new Date() }))
      );

      return conversation;
    });

    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'chat_conversation_created',
      resourceType: 'conversation',
      resourceId: created.id,
      result: 'success',
      metadata: { type: parsed.type, participantCount: participantIds.length }
    });

    revalidatePath('/dashboard/chat');
    return { id: created.id, reused: false };
  } catch (err) {
    throwSanitizedChatError(err, caller);
  }
}

export async function sendMessage(input: SendMessageInput) {
  const caller = await requireActiveEmployee();
  try {
    const parsed = sendMessageSchema.parse(input);

    if (!(await isConversationParticipant(caller, parsed.conversationId))) {
      throw new ExpectedChatError('Not permitted to post in this conversation');
    }

    const [created] = await db
      .insert(messages)
      .values({ conversationId: parsed.conversationId, authorEmployeeId: caller.id, body: parsed.body })
      .returning();

    await db
      .update(conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(and(eq(conversationParticipants.conversationId, parsed.conversationId), eq(conversationParticipants.employeeId, caller.id)));

    revalidatePath('/dashboard/chat');
    return created;
  } catch (err) {
    throwSanitizedChatError(err, caller);
  }
}

/**
 * Leaves a conversation — the only way to get one out of your own list, group or DM alike.
 * There's no group-membership tier here (see isConversationParticipant's own comment), so
 * "leave" just removes the caller's own participant row; a DM you've left stops delivering to
 * you rather than being un-leavable. When the last participant leaves, the conversation and its
 * messages are deleted outright (cascade via the FK) rather than left as an orphaned row nobody
 * can reach.
 */
export async function leaveConversation(conversationId: string) {
  const caller = await requireActiveEmployee();
  try {
    if (!(await isConversationParticipant(caller, conversationId))) {
      throw new ExpectedChatError('Not permitted to leave this conversation');
    }

    await db
      .delete(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.employeeId, caller.id)
        )
      );

    const [{ remaining }] = await db
      .select({ remaining: count() })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));

    if (remaining === 0) {
      await db.delete(conversations).where(eq(conversations.id, conversationId));
    }

    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'chat_conversation_left',
      resourceType: 'conversation',
      resourceId: conversationId,
      result: 'success',
      metadata: { conversationDeleted: remaining === 0 }
    });

    revalidatePath('/dashboard/chat');
  } catch (err) {
    throwSanitizedChatError(err, caller);
  }
}

export async function markConversationRead(conversationId: string) {
  const caller = await requireActiveEmployee();
  try {
    if (!(await isConversationParticipant(caller, conversationId))) {
      throw new ExpectedChatError('Not permitted to view this conversation');
    }

    await db
      .update(conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.employeeId, caller.id)));
  } catch (err) {
    throwSanitizedChatError(err, caller);
  }
}
