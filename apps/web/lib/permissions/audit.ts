import { db } from '@/lib/db/client';
import { auditLog } from '@/lib/db/schema';

export type AuditResult = 'success' | 'denied' | 'error';

export type AuditEvent = {
  actorEmployeeId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result: AuditResult;
  metadata?: Record<string, unknown>;
};

// Append-only: this is the only write path into audit_log. Never add an update/delete helper
// here — see the immutability note on the table in lib/db/schema.ts. `metadata` must never
// contain passwords, API keys, session tokens, or AI prompt content (engineering rule 11).
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  await db.insert(auditLog).values({
    actorEmployeeId: event.actorEmployeeId,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId ?? null,
    result: event.result,
    metadata: event.metadata ?? null
  });
}
