'use server';

import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { emailActivity, enquiries } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { teamForNewRecord } from '@/lib/permissions/default-team';
import { canCreateEnquiry, canEditEnquiry, type EnquiryTarget } from '@/lib/permissions/enquiry-access';
import { triggerNewEnquiry, scheduleNoResponseFollowUp } from '@/lib/automations/trigger';
import { sendMessage } from '@/lib/integrations/hostinger-mail/client';
import { getHostingerMailCredentials, isIntegrationEnabled } from '@/lib/integrations/settings';
import { INTEGRATION_KEYS } from '@/lib/integrations/keys';
import {
  createEnquirySchema,
  replyToEnquirySchema,
  setEnquiryStatusSchema,
  type CreateEnquiryInput,
  type ReplyToEnquiryInput,
  type SetEnquiryStatusInput
} from './utils/schemas';

async function getEnquiryOrThrow(enquiryId: string) {
  const [enquiry] = await db.select().from(enquiries).where(eq(enquiries.id, enquiryId)).limit(1);
  if (!enquiry) throw new Error('Enquiry not found');
  return enquiry;
}

function toTarget(enquiry: { id: string; team: string }): EnquiryTarget {
  return { id: enquiry.id, team: enquiry.team };
}

export async function createEnquiry(input: CreateEnquiryInput) {
  const caller = await requireActiveEmployee();
  if (!canCreateEnquiry(caller)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'enquiry_created',
      resourceType: 'enquiry',
      result: 'denied'
    });
    throw new Error('Not permitted to create an enquiry');
  }

  const parsed = createEnquirySchema.parse(input);

  let team = teamForNewRecord(caller.team);
  if (parsed.team && parsed.team !== team) {
    if (caller.role !== 'ADMIN') {
      throw new Error('Only an ADMIN can create an enquiry outside your own team');
    }
    team = parsed.team;
  }

  const [created] = await db
    .insert(enquiries)
    .values({
      contactName: parsed.contactName,
      contactEmail: parsed.contactEmail,
      message: parsed.message ?? null,
      team,
      clientId: parsed.clientId ?? null,
      createdBy: caller.id
    })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'enquiry_created',
    resourceType: 'enquiry',
    resourceId: created.id,
    result: 'success',
    metadata: { team }
  });

  // Fire-and-forget from the caller's perspective — the queue, not this request, does the work.
  await triggerNewEnquiry(created.id);

  revalidatePath('/dashboard/automations');
  return created;
}

export async function setEnquiryStatus(enquiryId: string, input: SetEnquiryStatusInput) {
  const caller = await requireActiveEmployee();
  const parsed = setEnquiryStatusSchema.parse(input);
  const enquiry = await getEnquiryOrThrow(enquiryId);

  if (!canEditEnquiry(caller, toTarget(enquiry))) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'enquiry_status_changed',
      resourceType: 'enquiry',
      resourceId: enquiryId,
      result: 'denied'
    });
    throw new Error('Not permitted to update this enquiry');
  }

  const [updated] = await db
    .update(enquiries)
    .set({ status: parsed.status, updatedAt: new Date() })
    .where(eq(enquiries.id, enquiryId))
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'enquiry_status_changed',
    resourceType: 'enquiry',
    resourceId: enquiryId,
    result: 'success',
    metadata: { status: parsed.status }
  });

  // Schedule the no-response follow-up exactly on the transition into 'awaiting_response' —
  // not on every update, so re-saving the same status doesn't stack duplicate delayed jobs.
  if (parsed.status === 'awaiting_response' && enquiry.status !== 'awaiting_response') {
    await scheduleNoResponseFollowUp(enquiryId);
  }

  revalidatePath('/dashboard/automations');
  return updated;
}

// Sends via the connected mailbox, not Resend — a reply must come from the real mailbox address
// the contact wrote to, threaded against their message (inReplyTo), not SYRIX Forma's own
// system-notification sender.
export async function sendEnquiryReply(enquiryId: string, input: ReplyToEnquiryInput) {
  const caller = await requireActiveEmployee();
  const parsed = replyToEnquirySchema.parse(input);
  const enquiry = await getEnquiryOrThrow(enquiryId);

  if (!canEditEnquiry(caller, toTarget(enquiry))) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'enquiry_reply_sent',
      resourceType: 'enquiry',
      resourceId: enquiryId,
      result: 'denied'
    });
    throw new Error('Not permitted to reply to this enquiry');
  }

  if (!(await isIntegrationEnabled(INTEGRATION_KEYS.HOSTINGER_MAIL))) {
    throw new Error('Hostinger Mail is not connected — ask an ADMIN to connect it in Settings > Integrations');
  }
  const credentials = await getHostingerMailCredentials();
  if (!credentials) throw new Error('Hostinger Mail is not connected');

  const [lastInbound] = await db
    .select({ externalMessageId: emailActivity.externalMessageId })
    .from(emailActivity)
    .where(and(eq(emailActivity.enquiryId, enquiryId), eq(emailActivity.direction, 'inbound')))
    .orderBy(desc(emailActivity.occurredAt))
    .limit(1);

  const result = await sendMessage(
    { apiToken: credentials.apiToken, mailboxResourceId: credentials.mailboxResourceId },
    {
      to: [enquiry.contactEmail],
      subject: `Re: enquiry from ${enquiry.contactName}`,
      text: parsed.text,
      inReplyTo: lastInbound?.externalMessageId
    }
  );

  if (!result.ok) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'enquiry_reply_sent',
      resourceType: 'enquiry',
      resourceId: enquiryId,
      result: 'error',
      metadata: { error: result.error }
    });
    throw new Error(result.error);
  }

  await db.insert(emailActivity).values({
    direction: 'outbound',
    externalMessageId: result.data.uid,
    mailboxResourceId: credentials.mailboxResourceId,
    fromAddress: credentials.mailboxResourceId,
    toAddresses: [enquiry.contactEmail],
    subject: `Re: enquiry from ${enquiry.contactName}`,
    snippet: parsed.text.slice(0, 280),
    occurredAt: new Date(),
    enquiryId,
    clientId: enquiry.clientId
  });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'enquiry_reply_sent',
    resourceType: 'enquiry',
    resourceId: enquiryId,
    result: 'success'
  });

  revalidatePath('/dashboard/automations');
}
