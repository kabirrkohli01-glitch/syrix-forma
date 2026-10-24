'use server';

/* Reading and changing one person's SYRIX AI preferences.
 *
 * Always the CALLER'S OWN row. There is no employee id parameter and there must
 * not be one: these are personal preferences, and an action that took an id
 * would be an action somebody could use to change a colleague's settings. If an
 * admin ever needs to set these for somebody else, that belongs in Access
 * Control with its own permission check, not here.
 */

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';

import {
  DEFAULT_AI_SETTINGS,
  isAiLanguage,
  type AiSettings
} from './utils/settings';

export async function getAiSettings(): Promise<AiSettings> {
  const caller = await requireActiveEmployee();

  const [row] = await db
    .select({ language: employees.aiLanguage, hubAccess: employees.aiHubAccess })
    .from(employees)
    .where(eq(employees.id, caller.id))
    .limit(1);

  if (!row) return DEFAULT_AI_SETTINGS;

  return {
    /* A code the app no longer offers falls back rather than being handed to a
       prompt as an instruction to answer in a language nobody chose. */
    language: isAiLanguage(row.language) ? row.language : DEFAULT_AI_SETTINGS.language,
    hubAccess: row.hubAccess
  };
}

export async function updateAiSettings(input: { language?: string; hubAccess?: boolean }): Promise<AiSettings> {
  const caller = await requireActiveEmployee();

  const patch: { aiLanguage?: string; aiHubAccess?: boolean; updatedAt: Date } = { updatedAt: new Date() };

  if (input.language !== undefined) {
    if (!isAiLanguage(input.language)) throw new Error('That is not a language SYRIX AI can answer in.');
    patch.aiLanguage = input.language;
  }
  if (input.hubAccess !== undefined) {
    patch.aiHubAccess = Boolean(input.hubAccess);
  }

  const [updated] = await db
    .update(employees)
    .set(patch)
    .where(eq(employees.id, caller.id))
    .returning({ language: employees.aiLanguage, hubAccess: employees.aiHubAccess });

  /* Worth logging: switching the assistant's access to Hub records on or off is
     a change in what it is allowed to touch on this person's behalf, and the
     record of when that changed is the kind of thing an incident review asks
     for. The language is logged alongside it because they share a write. */
  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'forma_ai_settings_updated',
    resourceType: 'employee',
    resourceId: caller.id,
    result: 'success',
    metadata: { language: updated?.language, hubAccess: updated?.hubAccess }
  });

  revalidatePath('/dashboard/settings/forma-ai');

  return {
    language: isAiLanguage(updated?.language) ? updated.language : DEFAULT_AI_SETTINGS.language,
    hubAccess: updated?.hubAccess ?? DEFAULT_AI_SETTINGS.hubAccess
  };
}
