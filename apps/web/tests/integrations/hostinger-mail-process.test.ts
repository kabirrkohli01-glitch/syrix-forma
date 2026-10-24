import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { emailActivity, enquiries, integrations } from '@/lib/db/schema';
import { INTEGRATION_KEYS } from '@/lib/integrations/keys';
import { normalizeInboundMessage, processInboundMessage } from '@/lib/integrations/hostinger-mail/webhook';

// processInboundMessage calls triggerNewEnquiry on a genuinely new enquiry, which enqueues a
// real BullMQ job against the live Upstash queue — same trap fixed in tests/tasks/task-actions
// .test.ts for the task-completed trigger. Mocked here for the same reason: this suite tests
// email-processing logic, not the queue's own delivery, and must not spam the live queue or its
// admin-failure notifications on every test run.
const mockTriggerNewEnquiry = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/automations/trigger', () => ({
  triggerNewEnquiry: (...args: unknown[]) => mockTriggerNewEnquiry(...args)
}));

const runTag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const mailboxResourceId = `mbx_test_${runTag}`;
const testTeam = `test-team-${runTag}`;

const createdEnquiryIds: string[] = [];
const createdActivityIds: string[] = [];
let originalConfig: unknown;

beforeAll(async () => {
  const [row] = await db
    .select({ config: integrations.config })
    .from(integrations)
    .where(eq(integrations.key, INTEGRATION_KEYS.HOSTINGER_MAIL))
    .limit(1);
  originalConfig = row?.config ?? null;

  await db
    .update(integrations)
    .set({ config: { defaultTeam: testTeam } })
    .where(eq(integrations.key, INTEGRATION_KEYS.HOSTINGER_MAIL));
});

afterAll(async () => {
  await db
    .update(integrations)
    .set({ config: originalConfig as object | null })
    .where(eq(integrations.key, INTEGRATION_KEYS.HOSTINGER_MAIL));

  for (const id of createdActivityIds) await db.delete(emailActivity).where(eq(emailActivity.id, id));
  for (const id of createdEnquiryIds) await db.delete(enquiries).where(eq(enquiries.id, id));
});

afterEach(() => {
  mockTriggerNewEnquiry.mockClear();
});

describe('processInboundMessage', () => {
  it('creates a new email-sourced enquiry and records inbound activity', async () => {
    const message = normalizeInboundMessage({
      uid: `new-${runTag}`,
      from: `contact-${runTag}@example.test`,
      to: ['mailbox@example.com'],
      subject: 'A new enquiry',
      snippet: 'Hello, I would like to enquire...',
      date: new Date().toISOString()
    });

    const result = await processInboundMessage(mailboxResourceId, message);
    expect(result.created).toBe(true);
    createdEnquiryIds.push(result.enquiryId);

    const [enquiry] = await db.select().from(enquiries).where(eq(enquiries.id, result.enquiryId));
    expect(enquiry.source).toBe('email');
    expect(enquiry.team).toBe(testTeam);
    expect(enquiry.createdBy).toBeNull();
    expect(mockTriggerNewEnquiry).toHaveBeenCalledWith(result.enquiryId);

    const [activity] = await db
      .select()
      .from(emailActivity)
      .where(and(eq(emailActivity.mailboxResourceId, mailboxResourceId), eq(emailActivity.externalMessageId, message.externalMessageId)));
    expect(activity).toBeDefined();
    if (activity) createdActivityIds.push(activity.id);
  });

  it('is idempotent — reprocessing the same external message id does not create a second enquiry', async () => {
    const message = normalizeInboundMessage({
      uid: `dupe-${runTag}`,
      from: `dupe-${runTag}@example.test`,
      subject: 'Duplicate delivery',
      date: new Date().toISOString()
    });

    const first = await processInboundMessage(mailboxResourceId, message);
    createdEnquiryIds.push(first.enquiryId);
    const second = await processInboundMessage(mailboxResourceId, message);

    expect(second.created).toBe(false);
    expect(second.enquiryId).toBe(first.enquiryId);
    expect(mockTriggerNewEnquiry).toHaveBeenCalledTimes(1);

    const activityRows = await db
      .select()
      .from(emailActivity)
      .where(and(eq(emailActivity.mailboxResourceId, mailboxResourceId), eq(emailActivity.externalMessageId, message.externalMessageId)));
    expect(activityRows).toHaveLength(1);
    if (activityRows[0]) createdActivityIds.push(activityRows[0].id);
  });

  it('flips an existing open enquiry to responded instead of creating a new one', async () => {
    const contactEmail = `existing-${runTag}@example.test`;
    const [existing] = await db
      .insert(enquiries)
      .values({ contactName: 'Existing Contact', contactEmail, team: testTeam, status: 'awaiting_response' })
      .returning();
    createdEnquiryIds.push(existing.id);

    const message = normalizeInboundMessage({
      uid: `reply-${runTag}`,
      from: contactEmail,
      subject: 'Re: enquiry',
      date: new Date().toISOString()
    });

    const result = await processInboundMessage(mailboxResourceId, message);
    expect(result.created).toBe(false);
    expect(result.enquiryId).toBe(existing.id);
    expect(mockTriggerNewEnquiry).not.toHaveBeenCalled();

    const [updated] = await db.select().from(enquiries).where(eq(enquiries.id, existing.id));
    expect(updated.status).toBe('responded');

    const [activity] = await db
      .select()
      .from(emailActivity)
      .where(and(eq(emailActivity.mailboxResourceId, mailboxResourceId), eq(emailActivity.externalMessageId, message.externalMessageId)));
    if (activity) createdActivityIds.push(activity.id);
  });
});
