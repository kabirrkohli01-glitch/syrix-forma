import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { automationSettings, automations } from '@/lib/db/schema';
import type { AutomationKey } from '@/lib/automations/keys';

// Checked twice by design: once by the trigger before enqueueing (fails fast, records a
// `skipped` run immediately so the UI shows *why* nothing happened) and again inside the worker
// right before the action runs (defense in depth — someone may flip either switch after a job
// was already queued or is sitting out a delay).
export async function isAutomationsEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ killSwitchEnabled: automationSettings.killSwitchEnabled })
    .from(automationSettings)
    .where(eq(automationSettings.id, 'singleton'))
    .limit(1);
  // Fail closed: if the singleton row is somehow missing, treat automations as off rather than
  // silently defaulting to on.
  return row?.killSwitchEnabled ?? false;
}

export async function isAutomationEnabled(key: AutomationKey): Promise<boolean> {
  const [row] = await db
    .select({ enabled: automations.enabled })
    .from(automations)
    .where(eq(automations.key, key))
    .limit(1);
  return row?.enabled ?? false;
}
