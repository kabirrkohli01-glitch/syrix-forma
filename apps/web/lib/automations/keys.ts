// Stable identifiers shared between the enqueue side (Server Actions), the worker's dispatch
// table, and the `automations.key` column seeded by migration 0004 — keep all three in sync.
export const AUTOMATION_KEYS = {
  NEW_ENQUIRY: 'new-enquiry',
  NO_RESPONSE_FOLLOW_UP: 'no-response-follow-up',
  TASK_COMPLETED_PROJECT_SYNC: 'task-completed-project-sync',
  // Periodic scans (Phase 5), not single-resource-event-triggered — dispatched by a repeatable
  // BullMQ job scheduler (worker.ts) whose job name is the automation key itself, same dispatch
  // table as the event-triggered automations above. Each handler manages its own run-row
  // lifecycle (createQueuedRun/markRun*) since there's no separate Server Action call site to do
  // it beforehand the way trigger.ts does for the event-triggered ones.
  CLIENT_INACTIVITY_FOLLOW_UP: 'client-inactivity-follow-up',
  PROJECT_DEADLINE_REMINDER: 'project-deadline-reminder'
} as const;

export type AutomationKey = (typeof AUTOMATION_KEYS)[keyof typeof AUTOMATION_KEYS];

export const REMINDER_JOB_NAME = 'task-due-date-scan';
