import { timingSafeEqual } from 'node:crypto';
import * as z from 'zod';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { emailActivity, enquiries } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { triggerNewEnquiry } from '@/lib/automations/trigger';
import { getIntegration } from '@/lib/integrations/settings';
import { INTEGRATION_KEYS } from '@/lib/integrations/keys';

// Hostinger Mail's webhook auth is a per-webhook bearer token echoed on every delivery
// (Authorization: Bearer <token>), not an HMAC body signature — verified here with a
// constant-time comparison so response-timing can't leak the expected token a byte at a time.
export function verifyWebhookAuthorization(authorizationHeader: string | null, expectedToken: string): boolean {
  if (!authorizationHeader) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match) return false;

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// Deliberately tolerant: this normalizes whatever field names Hostinger's `message.received`
// payload actually uses at delivery time. Anything that doesn't match a recognized shape is
// dead-lettered by the caller for inspection rather than guessed at or dropped silently.
const inboundMessageSchema = z
  .object({
    uid: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    from: z.string().optional(),
    sender: z.string().optional(),
    to: z.union([z.array(z.string()), z.string()]).optional(),
    subject: z.string().optional().nullable(),
    snippet: z.string().optional().nullable(),
    preview: z.string().optional().nullable(),
    date: z.string().optional(),
    timestamp: z.string().optional()
  })
  .passthrough();

export type NormalizedInboundMessage = {
  externalMessageId: string;
  fromAddress: string;
  toAddresses: string[];
  subject: string | null;
  snippet: string | null;
  occurredAt: Date;
};

export function normalizeInboundMessage(rawMessage: unknown): NormalizedInboundMessage {
  const parsed = inboundMessageSchema.parse(rawMessage);

  const externalMessageId = String(parsed.uid ?? parsed.id ?? '');
  const fromAddress = parsed.from ?? parsed.sender ?? '';
  if (!externalMessageId || !fromAddress) {
    throw new Error('Webhook payload is missing a message id or sender address');
  }

  const toAddresses = Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [];
  const dateValue = parsed.date ?? parsed.timestamp;
  const occurredAt = dateValue ? new Date(dateValue) : new Date();

  return {
    externalMessageId,
    fromAddress,
    toAddresses,
    subject: parsed.subject ?? null,
    snippet: parsed.snippet ?? parsed.preview ?? null,
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt
  };
}

export type ProcessInboundResult = { enquiryId: string; created: boolean };

// Idempotent by design: a redelivered webhook, or the reconciliation pass rediscovering a
// message a webhook already reported, must never create a second enquiry or task for it.
export async function processInboundMessage(
  mailboxResourceId: string,
  message: NormalizedInboundMessage
): Promise<ProcessInboundResult> {
  const [existing] = await db
    .select({ id: emailActivity.id, enquiryId: emailActivity.enquiryId })
    .from(emailActivity)
    .where(
      and(
        eq(emailActivity.mailboxResourceId, mailboxResourceId),
        eq(emailActivity.externalMessageId, message.externalMessageId)
      )
    )
    .limit(1);
  if (existing) {
    return { enquiryId: existing.enquiryId ?? '', created: false };
  }

  const [openEnquiry] = await db
    .select()
    .from(enquiries)
    .where(and(eq(enquiries.contactEmail, message.fromAddress), ne(enquiries.status, 'closed')))
    .orderBy(desc(enquiries.createdAt))
    .limit(1);

  let enquiryId: string;
  let created = false;

  if (openEnquiry) {
    enquiryId = openEnquiry.id;
    // A reply from the contact is exactly the signal the no-response-follow-up automation is
    // waiting to see — flipping status here (not just recording activity) means that automation's
    // live re-check at fire time correctly no-ops instead of nagging someone who already replied.
    if (openEnquiry.status !== 'responded') {
      await db.update(enquiries).set({ status: 'responded', updatedAt: new Date() }).where(eq(enquiries.id, openEnquiry.id));
      await logAuditEvent({
        actorEmployeeId: null,
        action: 'enquiry_status_changed',
        resourceType: 'enquiry',
        resourceId: openEnquiry.id,
        result: 'success',
        metadata: { status: 'responded', via: 'hostinger_mail_webhook' }
      });
    }
  } else {
    const integration = await getIntegration(INTEGRATION_KEYS.HOSTINGER_MAIL);
    const config = (integration?.config ?? {}) as { defaultTeam?: string };
    if (!config.defaultTeam) {
      throw new Error('Hostinger Mail integration has no default team configured for new enquiries');
    }

    const [newEnquiry] = await db
      .insert(enquiries)
      .values({
        source: 'email',
        contactName: message.fromAddress,
        contactEmail: message.fromAddress,
        message: message.snippet,
        team: config.defaultTeam,
        createdBy: null
      })
      .returning();
    enquiryId = newEnquiry.id;
    created = true;

    await logAuditEvent({
      actorEmployeeId: null,
      action: 'enquiry_created',
      resourceType: 'enquiry',
      resourceId: enquiryId,
      result: 'success',
      metadata: { source: 'email', via: 'hostinger_mail_webhook' }
    });

    await triggerNewEnquiry(enquiryId);
  }

  await db
    .insert(emailActivity)
    .values({
      direction: 'inbound',
      externalMessageId: message.externalMessageId,
      mailboxResourceId,
      fromAddress: message.fromAddress,
      toAddresses: message.toAddresses,
      subject: message.subject,
      snippet: message.snippet,
      occurredAt: message.occurredAt,
      enquiryId
    })
    .onConflictDoNothing();

  return { enquiryId, created };
}
