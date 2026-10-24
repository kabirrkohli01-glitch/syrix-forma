import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conversationParticipants, conversations, employees, messageAttachments, messages } from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';

export type ConversationSummary = {
  id: string;
  type: 'dm' | 'group';
  displayName: string;
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  unread: boolean;
};

// No unread-count/last-message column on `conversations` itself — both are derived on read from
// `messages`/`conversationParticipants.lastReadAt` rather than kept as denormalized counters that
// could drift, at the message volume an internal tool like this actually sees.
export async function listConversationsForEmployee(employeeId: string): Promise<ConversationSummary[]> {
  const participantRows = await db
    .select({
      conversationId: conversationParticipants.conversationId,
      lastReadAt: conversationParticipants.lastReadAt
    })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.employeeId, employeeId));

  if (participantRows.length === 0) return [];

  const conversationIds = participantRows.map((r) => r.conversationId);
  const lastReadByConversation = new Map(participantRows.map((r) => [r.conversationId, r.lastReadAt]));

  const [conversationRows, otherParticipantRows, recentMessages] = await Promise.all([
    db
      .select({ id: conversations.id, type: conversations.type, name: conversations.name })
      .from(conversations)
      .where(inArray(conversations.id, conversationIds)),
    db
      .select({ conversationId: conversationParticipants.conversationId, name: employeeDisplayName })
      .from(conversationParticipants)
      .innerJoin(employees, eq(employees.id, conversationParticipants.employeeId))
      .where(
        and(inArray(conversationParticipants.conversationId, conversationIds), ne(conversationParticipants.employeeId, employeeId))
      ),
    db
      .select({ conversationId: messages.conversationId, body: messages.body, createdAt: messages.createdAt })
      .from(messages)
      .where(inArray(messages.conversationId, conversationIds))
      .orderBy(desc(messages.createdAt))
  ]);

  const otherNamesByConversation = new Map<string, string[]>();
  for (const row of otherParticipantRows) {
    const names = otherNamesByConversation.get(row.conversationId) ?? [];
    names.push(row.name);
    otherNamesByConversation.set(row.conversationId, names);
  }

  // recentMessages is ordered newest-first — the first row seen per conversation is its last
  // message, cheap to pick up in one pass instead of a per-conversation query.
  const lastMessageByConversation = new Map<string, { body: string; createdAt: Date }>();
  for (const row of recentMessages) {
    if (!lastMessageByConversation.has(row.conversationId)) {
      lastMessageByConversation.set(row.conversationId, { body: row.body, createdAt: row.createdAt });
    }
  }

  const summaries: ConversationSummary[] = conversationRows.map((c) => {
    const lastMessage = lastMessageByConversation.get(c.id) ?? null;
    const lastReadAt = lastReadByConversation.get(c.id) ?? null;
    const otherNames = otherNamesByConversation.get(c.id) ?? [];

    return {
      id: c.id,
      type: c.type,
      displayName: c.name ?? (otherNames.length > 0 ? otherNames.join(', ') : 'Just you'),
      lastMessagePreview: lastMessage?.body ?? null,
      lastMessageAt: lastMessage?.createdAt ?? null,
      unread: Boolean(lastMessage && (!lastReadAt || lastMessage.createdAt > lastReadAt))
    };
  });

  return summaries.sort((a, b) => {
    const aTime = a.lastMessageAt?.getTime() ?? 0;
    const bTime = b.lastMessageAt?.getTime() ?? 0;
    return bTime - aTime;
  });
}

// Lean COUNT for the sidebar's Team Chat badge — same "unread" definition as
// ConversationSummary.unread above (a message newer than the participant's lastReadAt, or no
// read receipt at all), but without building the full conversation-list payload.
export async function countUnreadConversationsForEmployee(employeeId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${conversationParticipants.conversationId})::int` })
    .from(conversationParticipants)
    .innerJoin(messages, eq(messages.conversationId, conversationParticipants.conversationId))
    .where(
      and(
        eq(conversationParticipants.employeeId, employeeId),
        or(isNull(conversationParticipants.lastReadAt), gt(messages.createdAt, conversationParticipants.lastReadAt))
      )
    );
  return row?.count ?? 0;
}

export type MessageWithAttachments = {
  id: string;
  authorEmployeeId: string | null;
  authorName: string | null;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
};

const MESSAGE_PAGE_SIZE = 50;

/** Returns up to 50 messages, oldest first. Pass `before` (a message's createdAt) to page further back. */
export async function getConversationMessages(conversationId: string, before?: Date): Promise<MessageWithAttachments[]> {
  const rows = await db
    .select({
      id: messages.id,
      authorEmployeeId: messages.authorEmployeeId,
      authorName: employeeDisplayName,
      body: messages.body,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt
    })
    .from(messages)
    .leftJoin(employees, eq(employees.id, messages.authorEmployeeId))
    .where(before ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, before)) : eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(MESSAGE_PAGE_SIZE);

  const messageIds = rows.map((r) => r.id);
  const attachmentRows = messageIds.length
    ? await db
        .select({
          id: messageAttachments.id,
          messageId: messageAttachments.messageId,
          fileName: messageAttachments.fileName,
          mimeType: messageAttachments.mimeType,
          sizeBytes: messageAttachments.sizeBytes
        })
        .from(messageAttachments)
        .where(inArray(messageAttachments.messageId, messageIds))
    : [];

  const attachmentsByMessage = new Map<string, MessageWithAttachments['attachments']>();
  for (const row of attachmentRows) {
    const list = attachmentsByMessage.get(row.messageId) ?? [];
    list.push({ id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes });
    attachmentsByMessage.set(row.messageId, list);
  }

  return rows
    .map((row) => ({ ...row, attachments: attachmentsByMessage.get(row.id) ?? [] }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** For a 1:1 DM, reuse an existing conversation between exactly these two employees instead of creating a duplicate. */
export async function findExistingDmConversation(employeeIdA: string, employeeIdB: string): Promise<string | null> {
  const rows = await db
    .select({ conversationId: conversationParticipants.conversationId, employeeId: conversationParticipants.employeeId })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .where(and(eq(conversations.type, 'dm'), inArray(conversationParticipants.employeeId, [employeeIdA, employeeIdB])));

  const byConversation = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = byConversation.get(row.conversationId) ?? new Set<string>();
    set.add(row.employeeId);
    byConversation.set(row.conversationId, set);
  }

  for (const [conversationId, participantIds] of byConversation) {
    if (participantIds.size === 2 && participantIds.has(employeeIdA) && participantIds.has(employeeIdB)) {
      return conversationId;
    }
  }

  return null;
}

export async function getConversationParticipantIds(conversationId: string): Promise<string[]> {
  const rows = await db
    .select({ employeeId: conversationParticipants.employeeId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversationId));
  return rows.map((r) => r.employeeId);
}
