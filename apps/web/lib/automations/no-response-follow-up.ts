import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { enquiries } from '@/lib/db/schema';
import { createNotification } from '@/lib/notifications/in-app';
import { sendEmail } from '@/lib/notifications/email';
import { isAutomationsEnabled } from '@/lib/queue/kill-switch';
import { getAutomationByKey, markRunFailed, markRunRunning, markRunSkipped, markRunSuccess } from '@/lib/queue/audit-run';
import { AUTOMATION_KEYS } from './keys';
import { resolveRecipients } from './new-enquiry';

export type NoResponseFollowUpJobData = { runId: string; enquiryId: string };

// EVENT (ENQUIRY_AWAITING_RESPONSE) -> RULE (fires after a configurable delay) -> ACTION
// (notify + email) -> RESULT -> AUDIT, same shape as new-enquiry.ts.
export async function handleNoResponseFollowUp(job: Job<NoResponseFollowUpJobData>): Promise<void> {
  const { runId, enquiryId } = job.data;

  const [globalEnabled, automation] = await Promise.all([
    isAutomationsEnabled(),
    getAutomationByKey(AUTOMATION_KEYS.NO_RESPONSE_FOLLOW_UP)
  ]);
  if (!globalEnabled || !automation.enabled) {
    await markRunSkipped(runId, 'Automation disabled before the job ran');
    return;
  }

  await markRunRunning(runId);

  const [enquiry] = await db.select().from(enquiries).where(eq(enquiries.id, enquiryId)).limit(1);
  if (!enquiry) {
    await markRunFailed(runId, `Enquiry ${enquiryId} no longer exists`);
    return;
  }

  // The one subtle correctness point in this automation: re-check the enquiry's CURRENT status
  // here, not the status it had when this delayed job was scheduled. A response or closure that
  // happened during the delay window makes this a stale trigger — it must no-op, not nag a
  // resolved enquiry.
  if (enquiry.status !== 'awaiting_response') {
    await markRunSkipped(
      runId,
      `Enquiry status is now '${enquiry.status}', not 'awaiting_response' — no follow-up needed`
    );
    return;
  }

  const recipients = await resolveRecipients(enquiry.createdBy);

  await Promise.all(
    recipients.map((recipient) =>
      createNotification({
        employeeId: recipient.id,
        type: 'follow_up_due',
        title: `Follow up: ${enquiry.contactName}`,
        body: 'No response yet — this enquiry has been awaiting a response for a while.',
        link: '/dashboard/automations'
      })
    )
  );

  const emailResults = await Promise.all(
    recipients.map((recipient) =>
      sendEmail({
        to: recipient.email,
        subject: `Follow-up needed: ${enquiry.contactName}`,
        body: `${enquiry.contactName} (${enquiry.contactEmail}) hasn't responded yet. Consider following up.`
      })
    )
  );

  const failedEmail = emailResults.find((result) => !result.ok);
  if (failedEmail && !failedEmail.ok) {
    await markRunFailed(runId, `Notification was created, but the email failed: ${failedEmail.error}`);
    return;
  }

  await markRunSuccess(runId, {});
}
