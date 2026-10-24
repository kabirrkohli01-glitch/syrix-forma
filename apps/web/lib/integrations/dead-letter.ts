import { desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { deadLetterJobs } from '@/lib/db/schema';

// Anything that fails processing an integration's inbound event (a malformed webhook payload, a
// reconciliation-pass exception) lands here instead of throwing past the caller — a webhook
// route in particular must always return 200 once signature verification passes, or the sender
// will keep retrying a payload SYRIX Forma can never process. Never throws itself.
export async function deadLetter(source: string, payload: unknown, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await db.insert(deadLetterJobs).values({ source, payload: payload as object, error: message });
  } catch (insertErr) {
    console.error(`[integrations/dead-letter] failed to record dead-letter for '${source}':`, insertErr);
  }
}

export async function listUnresolvedDeadLetters(source?: string) {
  const rows = await db
    .select()
    .from(deadLetterJobs)
    .where(isNull(deadLetterJobs.resolvedAt))
    .orderBy(desc(deadLetterJobs.failedAt))
    .limit(50);
  return source ? rows.filter((row) => row.source === source) : rows;
}

export async function resolveDeadLetter(id: string, resolvedByEmployeeId: string): Promise<void> {
  await db
    .update(deadLetterJobs)
    .set({ resolvedAt: new Date(), resolvedByEmployeeId })
    .where(eq(deadLetterJobs.id, id));
}
