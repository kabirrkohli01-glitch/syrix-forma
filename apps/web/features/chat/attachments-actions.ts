'use server';

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { messageAttachments, messages } from '@/lib/db/schema';
import { isConversationParticipant } from '@/lib/permissions/chat-access';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { getStorageAdapter } from '@/lib/storage';
import { ExpectedChatError, throwSanitizedChatError } from './utils/errors';
import {
  confirmAttachmentSchema,
  requestAttachmentUploadSchema,
  type ConfirmAttachmentInput,
  type RequestAttachmentUploadInput
} from './utils/schemas';

/**
 * Step 1 of the upload flow: validate permission + file type/size, then hand back a presigned
 * PUT target. The caller uploads bytes straight to storage from there — they never pass through
 * this server. Nothing is written to messageAttachments until confirmAttachment (step 2) proves
 * the upload actually happened.
 */
export async function requestAttachmentUpload(input: RequestAttachmentUploadInput) {
  const caller = await requireActiveEmployee();
  try {
    const parsed = requestAttachmentUploadSchema.parse(input);

    if (!(await isConversationParticipant(caller, parsed.conversationId))) {
      throw new ExpectedChatError('Not permitted to attach files in this conversation');
    }

    const sanitizedFileName = parsed.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `chat/${parsed.conversationId}/${randomUUID()}-${sanitizedFileName}`;

    const target = await getStorageAdapter().createUploadUrl(storageKey, parsed.mimeType);
    return { storageKey, ...target };
  } catch (err) {
    throwSanitizedChatError(err, caller);
  }
}

/** Step 2: the message this attachment belongs to must already exist and be the caller's own. */
export async function confirmAttachment(input: ConfirmAttachmentInput) {
  const caller = await requireActiveEmployee();
  try {
    const parsed = confirmAttachmentSchema.parse(input);

    const [message] = await db.select().from(messages).where(eq(messages.id, parsed.messageId)).limit(1);
    if (!message) throw new ExpectedChatError('Message not found');
    if (message.authorEmployeeId !== caller.id) {
      throw new ExpectedChatError('Only the message author can attach a file to it');
    }
    if (!(await isConversationParticipant(caller, message.conversationId))) {
      throw new ExpectedChatError('Not permitted to attach files in this conversation');
    }

    const [created] = await db
      .insert(messageAttachments)
      .values({
        messageId: parsed.messageId,
        storageKey: parsed.storageKey,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        sizeBytes: parsed.sizeBytes
      })
      .returning();

    revalidatePath('/dashboard/chat');
    return created;
  } catch (err) {
    throwSanitizedChatError(err, caller);
  }
}

/** Issues a fresh, short-lived download URL — never store or reuse one past its own request. */
export async function getAttachmentDownloadUrl(attachmentId: string) {
  const caller = await requireActiveEmployee();
  try {
    const [attachment] = await db
      .select({ id: messageAttachments.id, storageKey: messageAttachments.storageKey, conversationId: messages.conversationId })
      .from(messageAttachments)
      .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
      .where(eq(messageAttachments.id, attachmentId))
      .limit(1);

    if (!attachment) throw new ExpectedChatError('Attachment not found');
    if (!(await isConversationParticipant(caller, attachment.conversationId))) {
      throw new ExpectedChatError('Not permitted to view this attachment');
    }

    return await getStorageAdapter().createDownloadUrl(attachment.storageKey);
  } catch (err) {
    throwSanitizedChatError(err, caller);
  }
}
