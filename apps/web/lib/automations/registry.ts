import type { Job } from 'bullmq';
import { handleClientInactivityFollowUp } from './client-inactivity-follow-up';
import { AUTOMATION_KEYS } from './keys';
import { handleNewEnquiry } from './new-enquiry';
import { handleNoResponseFollowUp } from './no-response-follow-up';
import { handleProjectDeadlineReminder } from './project-deadline-reminder';
import { handleTaskCompletedProjectSync } from './task-completed-project-sync';

// Dispatch table the worker uses to route a job by name (== automations.key) to its handler.
export const automationHandlers: Record<string, (job: Job) => Promise<void>> = {
  [AUTOMATION_KEYS.NEW_ENQUIRY]: handleNewEnquiry,
  [AUTOMATION_KEYS.NO_RESPONSE_FOLLOW_UP]: handleNoResponseFollowUp,
  [AUTOMATION_KEYS.TASK_COMPLETED_PROJECT_SYNC]: handleTaskCompletedProjectSync,
  [AUTOMATION_KEYS.CLIENT_INACTIVITY_FOLLOW_UP]: handleClientInactivityFollowUp,
  [AUTOMATION_KEYS.PROJECT_DEADLINE_REMINDER]: handleProjectDeadlineReminder
};
