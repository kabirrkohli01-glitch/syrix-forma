import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees, enquiries, tasks } from '@/lib/db/schema';
import { getIntegration } from '@/lib/integrations/settings';
import { INTEGRATION_KEYS } from '@/lib/integrations/keys';
import { createNotification } from '@/lib/notifications/in-app';
import { sendEmail } from '@/lib/notifications/email';
import { isAutomationsEnabled } from '@/lib/queue/kill-switch';
import { getAutomationByKey, markRunFailed, markRunRunning, markRunSkipped, markRunSuccess } from '@/lib/queue/audit-run';
import { AUTOMATION_KEYS } from './keys';

export type NewEnquiryJobData = { runId: string; enquiryId: string };

// A manually-logged enquiry always has a creator to notify. An email-detected one (source:
// 'email') doesn't — nobody at the organisation typed it in — so it falls back to the Hostinger Mail
// integration's named owner, or every active ADMIN if no owner is set yet, same fallback
// audit-run.ts uses for automation-failure notifications.
export async function resolveRecipients(createdBy: string | null): Promise<{ id: string; email: string }[]> {
  if (createdBy) {
    const [creator] = await db
      .select({ id: employees.id, email: employees.email })
      .from(employees)
      .where(eq(employees.id, createdBy))
      .limit(1);
    return creator ? [creator] : [];
  }

  const integration = await getIntegration(INTEGRATION_KEYS.HOSTINGER_MAIL);
  if (integration?.ownerEmployeeId) {
    const [owner] = await db
      .select({ id: employees.id, email: employees.email })
      .from(employees)
      .where(eq(employees.id, integration.ownerEmployeeId))
      .limit(1);
    if (owner) return [owner];
  }

  return db
    .select({ id: employees.id, email: employees.email })
    .from(employees)
    .where(and(eq(employees.role, 'ADMIN'), eq(employees.status, 'active')));
}

// EVENT (ENQUIRY_CREATED) -> RULE (this automation, if enabled) -> ACTION (create a task,
// notify, email) -> RESULT (automation_runs row) -> AUDIT (the run itself is the audit trail;
// task creation goes through the normal task-created path's own implicit history via the row).
export async function handleNewEnquiry(job: Job<NewEnquiryJobData>): Promise<void> {
  const { runId, enquiryId } = job.data;

  // Defense in depth: re-check both switches right before acting — either may have been
  // flipped after this job was enqueued.
  const [globalEnabled, automation] = await Promise.all([
    isAutomationsEnabled(),
    getAutomationByKey(AUTOMATION_KEYS.NEW_ENQUIRY)
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

  const [task] = await db
    .insert(tasks)
    .values({
      title: `New enquiry: ${enquiry.contactName}`,
      description: enquiry.message,
      priority: 'high',
      team: enquiry.team,
      clientId: enquiry.clientId
    })
    .returning();

  const recipients = await resolveRecipients(enquiry.createdBy);

  await Promise.all(
    recipients.map((recipient) =>
      createNotification({
        employeeId: recipient.id,
        type: 'enquiry_task_created',
        title: `New enquiry from ${enquiry.contactName}`,
        body: 'A task has been created to follow up on this enquiry.',
        link: '/dashboard/my-work'
      })
    )
  );

  const emailResults = await Promise.all(
    recipients.map((recipient) =>
      sendEmail({
        to: recipient.email,
        subject: `New enquiry: ${enquiry.contactName}`,
        body: `A new enquiry from ${enquiry.contactName} (${enquiry.contactEmail}) has been logged and a task created for it.`
      })
    )
  );

  const failedEmail = emailResults.find((result) => !result.ok);
  if (failedEmail && !failedEmail.ok) {
    // Task and notification already committed — email failing must not roll those back or
    // pretend they didn't happen. The failed status here is specifically about the email leg.
    await markRunFailed(runId, `Task and notification were created, but the email failed: ${failedEmail.error}`);
    return;
  }

  await markRunSuccess(runId, { taskId: task.id });
}
