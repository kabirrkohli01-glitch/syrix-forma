import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conversationParticipants } from '@/lib/db/schema';
import type { ActiveEmployee } from './current-employee';

/**
 * The only access rule Team Chat has, for every role including ADMIN — see
 * docs/permissions-matrix.md's "Implementation, Team Chat" section for why this deliberately
 * has no role/team scope tier the way Task/Client/Project do. Every server action that reads or
 * writes a conversation must call this before touching its rows, never trusting a
 * client-supplied conversationId.
 */
export async function isConversationParticipant(
  caller: ActiveEmployee,
  conversationId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: conversationParticipants.id })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.employeeId, caller.id)
      )
    )
    .limit(1);

  return Boolean(row);
}
