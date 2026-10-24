// Standalone BullMQ worker process — run alongside `next dev`/`next start`, not inside a Next.js
// request handler (BullMQ Workers are long-running processes; nothing about them fits a
// request/response lifecycle). Start with `npm run worker` (loads .env.local via
// scripts/preload-env.cjs, required before this file's own imports evaluate).
import { Worker } from 'bullmq';
import { getQueueConnection } from './lib/queue/connection';
import { AUTOMATION_KEYS, REMINDER_JOB_NAME } from './lib/automations/keys';
import { automationHandlers } from './lib/automations/registry';
import { runTaskDueDateScan } from './lib/automations/task-reminders';
import { getAutomationQueue, getIntegrationQueue, getReminderQueue } from './lib/queue/queues';
import { runHostingerMailReconciliation } from './lib/integrations/hostinger-mail/reconciliation';
import { runDocumentLinkReachabilityCheck } from './lib/integrations/document-links/reachability';
import { DOCUMENT_LINK_REACHABILITY_JOB_NAME, HOSTINGER_MAIL_RECONCILIATION_JOB_NAME } from './lib/integrations/keys';

async function main() {
  const connection = getQueueConnection();

  const automationWorker = new Worker(
    'automations',
    async (job) => {
      const handler = automationHandlers[job.name];
      if (!handler) throw new Error(`No automation handler registered for job name '${job.name}'`);
      await handler(job);
    },
    { connection }
  );
  automationWorker.on('failed', (job, err) => {
    console.error(`[worker] automation job ${job?.id} (${job?.name}) failed:`, err.message);
  });

  const reminderWorker = new Worker('reminders', async () => runTaskDueDateScan(), { connection });
  reminderWorker.on('failed', (job, err) => {
    console.error(`[worker] reminder job ${job?.id} failed:`, err.message);
  });

  const integrationWorker = new Worker(
    'integrations',
    async (job) => {
      if (job.name === HOSTINGER_MAIL_RECONCILIATION_JOB_NAME) return runHostingerMailReconciliation();
      if (job.name === DOCUMENT_LINK_REACHABILITY_JOB_NAME) return runDocumentLinkReachabilityCheck();
      throw new Error(`No reconciliation handler registered for job name '${job.name}'`);
    },
    { connection }
  );
  integrationWorker.on('failed', (job, err) => {
    console.error(`[worker] integration job ${job?.id} (${job?.name}) failed:`, err.message);
  });

  // Registered once at boot via a job scheduler (BullMQ v6's repeatable-job API) — upserting by
  // the same scheduler id is idempotent, so restarting the worker never creates duplicate
  // schedules. Once daily at 08:00 server time.
  await getReminderQueue().upsertJobScheduler(REMINDER_JOB_NAME, { pattern: '0 8 * * *' });

  // Hostinger Mail search catches anything a missed webhook delivery never reported — every 15
  // minutes, independent of whether any webhook fired at all. Document-link reachability is
  // cheap and less urgent — hourly.
  await getIntegrationQueue().upsertJobScheduler(HOSTINGER_MAIL_RECONCILIATION_JOB_NAME, { pattern: '*/15 * * * *' });
  await getIntegrationQueue().upsertJobScheduler(DOCUMENT_LINK_REACHABILITY_JOB_NAME, { pattern: '0 * * * *' });

  // Phase 5's periodic (not single-event-triggered) automations — job name is the automation key
  // itself, so the existing "automations" worker's dispatch table above routes them without any
  // special-casing. Once daily, same time as the task due-date scan.
  await getAutomationQueue().upsertJobScheduler(AUTOMATION_KEYS.CLIENT_INACTIVITY_FOLLOW_UP, { pattern: '0 8 * * *' });
  await getAutomationQueue().upsertJobScheduler(AUTOMATION_KEYS.PROJECT_DEADLINE_REMINDER, { pattern: '0 8 * * *' });

  console.warn(
    '[worker] SYRIX Forma automation worker started — listening on "automations", "reminders", and "integrations"'
  );

  const shutdown = async () => {
    console.warn('[worker] shutting down...');
    await Promise.all([automationWorker.close(), reminderWorker.close(), integrationWorker.close()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[worker] fatal error during startup:', err);
  process.exit(1);
});
