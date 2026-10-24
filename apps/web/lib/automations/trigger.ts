import { getAutomationQueue } from '@/lib/queue/queues';
import { createQueuedRun, createSkippedRun, getAutomationByKey } from '@/lib/queue/audit-run';
import { isAutomationsEnabled } from '@/lib/queue/kill-switch';
import { AUTOMATION_KEYS } from './keys';
import type { NewEnquiryJobData } from './new-enquiry';
import type { NoResponseFollowUpJobData } from './no-response-follow-up';
import type { TaskCompletedProjectSyncJobData } from './task-completed-project-sync';

// Called from features/enquiries/actions.ts right after an enquiry insert. Enqueues, doesn't
// await completion — that's the whole point of the queue. Both kill-switches are checked here
// so a disabled automation records a `skipped` run immediately, instead of leaving the caller
// wondering why nothing happened.
export async function triggerNewEnquiry(enquiryId: string): Promise<void> {
  const automation = await getAutomationByKey(AUTOMATION_KEYS.NEW_ENQUIRY);
  const trigger = { triggerResourceType: 'enquiry', triggerResourceId: enquiryId };

  if (!(await isAutomationsEnabled())) {
    await createSkippedRun(automation.id, 'Master automation kill-switch is off', trigger);
    return;
  }
  if (!automation.enabled) {
    await createSkippedRun(automation.id, 'This automation is turned off', trigger);
    return;
  }

  const runId = await createQueuedRun(automation.id, trigger);
  const data: NewEnquiryJobData = { runId, enquiryId };
  await getAutomationQueue().add(AUTOMATION_KEYS.NEW_ENQUIRY, data);
}

// Called when an enquiry's status transitions to 'awaiting_response'. Schedules a delayed job —
// `followUpAfterDays` comes from the automation's own config row (docs/data-model.md), editable
// via the Automations page.
export async function scheduleNoResponseFollowUp(enquiryId: string): Promise<void> {
  const automation = await getAutomationByKey(AUTOMATION_KEYS.NO_RESPONSE_FOLLOW_UP);
  const trigger = { triggerResourceType: 'enquiry', triggerResourceId: enquiryId };

  if (!(await isAutomationsEnabled())) {
    await createSkippedRun(automation.id, 'Master automation kill-switch is off', trigger);
    return;
  }
  if (!automation.enabled) {
    await createSkippedRun(automation.id, 'This automation is turned off', trigger);
    return;
  }

  const config = (automation.config ?? {}) as { followUpAfterDays?: number };
  const days = typeof config.followUpAfterDays === 'number' ? config.followUpAfterDays : 3;
  const delay = days * 24 * 60 * 60 * 1000;

  const runId = await createQueuedRun(automation.id, trigger);
  const data: NoResponseFollowUpJobData = { runId, enquiryId };
  await getAutomationQueue().add(AUTOMATION_KEYS.NO_RESPONSE_FOLLOW_UP, data, { delay });
}

// Called from features/tasks/actions.ts whenever a task's status actually transitions to
// 'done' (not on every save that merely keeps it 'done').
export async function triggerTaskCompleted(taskId: string): Promise<void> {
  const automation = await getAutomationByKey(AUTOMATION_KEYS.TASK_COMPLETED_PROJECT_SYNC);
  const trigger = { triggerResourceType: 'task', triggerResourceId: taskId };

  if (!(await isAutomationsEnabled())) {
    await createSkippedRun(automation.id, 'Master automation kill-switch is off', trigger);
    return;
  }
  if (!automation.enabled) {
    await createSkippedRun(automation.id, 'This automation is turned off', trigger);
    return;
  }

  const runId = await createQueuedRun(automation.id, trigger);
  const data: TaskCompletedProjectSyncJobData = { runId, taskId };
  await getAutomationQueue().add(AUTOMATION_KEYS.TASK_COMPLETED_PROJECT_SYNC, data);
}
