import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';

// Lazily constructed — importing this module must never throw at build time (e.g. during
// `next build`'s page-data collection, before REDIS_URL is necessarily relevant to the route
// being built). Connection errors only surface when a queue is actually used.
let cachedAutomationQueue: Queue | null = null;
let cachedReminderQueue: Queue | null = null;
let cachedIntegrationQueue: Queue | null = null;

// One queue per automation trigger family — job `name` maps to `automations.key`
// (lib/automations/keys.ts) so the worker can dispatch by name.
export function getAutomationQueue(): Queue {
  if (!cachedAutomationQueue) {
    cachedAutomationQueue = new Queue('automations', { connection: getQueueConnection() });
  }
  return cachedAutomationQueue;
}

// Separate queue for the recurring due-date scan, kept apart from event-triggered automations
// since it's a repeatable job registered once at worker boot, not something Server Actions
// enqueue on demand.
export function getReminderQueue(): Queue {
  if (!cachedReminderQueue) {
    cachedReminderQueue = new Queue('reminders', { connection: getQueueConnection() });
  }
  return cachedReminderQueue;
}

// Phase 4's periodic reconciliation passes (Hostinger Mail search, document-link reachability) —
// both repeatable jobs registered once at worker boot, same pattern as the reminder queue.
export function getIntegrationQueue(): Queue {
  if (!cachedIntegrationQueue) {
    cachedIntegrationQueue = new Queue('integrations', { connection: getQueueConnection() });
  }
  return cachedIntegrationQueue;
}
