'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { automations, automationSettings } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { canManageAutomations, canUseKillSwitch } from '@/lib/permissions/automation-access';
import { AUTOMATION_KEYS, type AutomationKey } from '@/lib/automations/keys';
import { setAutomationDaysSchema, type SetAutomationDaysInput } from './utils/schemas';

// Every automation whose config is just "N days", and the JSON field name that N lives under.
// Deliberately a fixed lookup, not a generic "write any key" setter — the shape of `config` is
// specific to each automation's own handler, and an arbitrary setter would invite writing a key
// no handler ever reads.
const DAYS_CONFIG_KEY: Partial<Record<AutomationKey, string>> = {
  [AUTOMATION_KEYS.NO_RESPONSE_FOLLOW_UP]: 'followUpAfterDays',
  [AUTOMATION_KEYS.CLIENT_INACTIVITY_FOLLOW_UP]: 'inactivityThresholdDays',
  [AUTOMATION_KEYS.PROJECT_DEADLINE_REMINDER]: 'daysBeforeDeadline'
};

export async function setKillSwitch(enabled: boolean) {
  const caller = await requireActiveEmployee();
  if (!canUseKillSwitch(caller)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'automation_kill_switch_changed',
      resourceType: 'automation_settings',
      result: 'denied'
    });
    throw new Error('Not permitted to use the automation kill-switch');
  }

  await db
    .update(automationSettings)
    .set({ killSwitchEnabled: enabled, updatedByEmployeeId: caller.id, updatedAt: new Date() })
    .where(eq(automationSettings.id, 'singleton'));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'automation_kill_switch_changed',
    resourceType: 'automation_settings',
    result: 'success',
    metadata: { enabled }
  });

  revalidatePath('/dashboard/automations');
}

export async function setAutomationEnabled(key: AutomationKey, enabled: boolean) {
  const caller = await requireActiveEmployee();
  if (!canManageAutomations(caller)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'automation_enabled_changed',
      resourceType: 'automation',
      resourceId: key,
      result: 'denied'
    });
    throw new Error('Not permitted to manage automations');
  }

  await db.update(automations).set({ enabled, updatedAt: new Date() }).where(eq(automations.key, key));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'automation_enabled_changed',
    resourceType: 'automation',
    resourceId: key,
    result: 'success',
    metadata: { enabled }
  });

  revalidatePath('/dashboard/automations');
}

export async function setAutomationOwner(key: AutomationKey, ownerEmployeeId: string | null) {
  const caller = await requireActiveEmployee();
  if (!canManageAutomations(caller)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'automation_owner_changed',
      resourceType: 'automation',
      resourceId: key,
      result: 'denied'
    });
    throw new Error('Not permitted to manage automations');
  }

  await db.update(automations).set({ ownerEmployeeId, updatedAt: new Date() }).where(eq(automations.key, key));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'automation_owner_changed',
    resourceType: 'automation',
    resourceId: key,
    result: 'success',
    metadata: { ownerEmployeeId }
  });

  revalidatePath('/dashboard/automations');
}

export async function setAutomationDaysConfig(key: AutomationKey, input: SetAutomationDaysInput) {
  const configKey = DAYS_CONFIG_KEY[key];
  if (!configKey) throw new Error(`Automation '${key}' has no days-based config`);

  const caller = await requireActiveEmployee();
  if (!canManageAutomations(caller)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'automation_config_changed',
      resourceType: 'automation',
      resourceId: key,
      result: 'denied'
    });
    throw new Error('Not permitted to manage automations');
  }

  const parsed = setAutomationDaysSchema.parse(input);

  await db.update(automations).set({ config: { [configKey]: parsed.days }, updatedAt: new Date() }).where(eq(automations.key, key));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'automation_config_changed',
    resourceType: 'automation',
    resourceId: key,
    result: 'success',
    metadata: { [configKey]: parsed.days }
  });

  revalidatePath('/dashboard/automations');
}
