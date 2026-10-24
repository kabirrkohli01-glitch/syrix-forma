'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { accessCodeModeEnabled } from '@/lib/auth/access-code-config';
import { db } from '@/lib/db/client';
import { integrations } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { canManageIntegrations } from '@/lib/permissions/integration-access';
import { INTEGRATION_KEYS, type IntegrationKey } from '@/lib/integrations/keys';
import {
  clearHostingerMailCredentials,
  getHostingerMailCredentials,
  setHostingerMailCredentials
} from '@/lib/integrations/settings';
import { searchMessages } from '@/lib/integrations/hostinger-mail/client';
import { resolveDeadLetter } from '@/lib/integrations/dead-letter';
import { saveHostingerMailCredentialsSchema, type SaveHostingerMailCredentialsInput } from './utils/schemas';

async function requireIntegrationManager() {
  // Refused before the permission check, because in access-code mode the permission check passes:
  // everyone holding the code is the same administrator. An integration row is shared with the
  // deployment that owns the real mailbox, so changing one here changes it there.
  if (accessCodeModeEnabled()) {
    throw new Error('Integrations cannot be changed from an access-code deployment');
  }

  const caller = await requireActiveEmployee();
  if (!canManageIntegrations(caller)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'integration_denied',
      resourceType: 'integration',
      result: 'denied'
    });
    throw new Error('Not permitted to manage integrations');
  }
  return caller;
}

export async function setIntegrationEnabled(key: IntegrationKey, enabled: boolean) {
  const caller = await requireIntegrationManager();

  await db.update(integrations).set({ enabled, updatedAt: new Date() }).where(eq(integrations.key, key));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'integration_enabled_changed',
    resourceType: 'integration',
    resourceId: key,
    result: 'success',
    metadata: { enabled }
  });

  revalidatePath('/dashboard/settings/integrations');
  revalidatePath('/dashboard/email');
}

export async function setIntegrationOwner(key: IntegrationKey, ownerEmployeeId: string | null) {
  const caller = await requireIntegrationManager();

  await db.update(integrations).set({ ownerEmployeeId, updatedAt: new Date() }).where(eq(integrations.key, key));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'integration_owner_changed',
    resourceType: 'integration',
    resourceId: key,
    result: 'success',
    metadata: { ownerEmployeeId }
  });

  revalidatePath('/dashboard/settings/integrations');
}

// Never logs the credential values themselves — only that a save happened
// (engineering rule 11: never log passwords/keys/tokens).
export async function saveHostingerMailCredentials(input: SaveHostingerMailCredentialsInput) {
  const caller = await requireIntegrationManager();
  const parsed = saveHostingerMailCredentialsSchema.parse(input);

  await setHostingerMailCredentials({
    apiToken: parsed.apiToken,
    mailboxResourceId: parsed.mailboxResourceId,
    webhookToken: parsed.webhookToken
  });

  await db
    .update(integrations)
    .set({ config: { defaultTeam: parsed.defaultTeam }, updatedAt: new Date() })
    .where(eq(integrations.key, INTEGRATION_KEYS.HOSTINGER_MAIL));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'integration_credentials_saved',
    resourceType: 'integration',
    resourceId: INTEGRATION_KEYS.HOSTINGER_MAIL,
    result: 'success'
  });

  revalidatePath('/dashboard/settings/integrations');
}

export async function removeHostingerMailCredentials() {
  const caller = await requireIntegrationManager();

  await clearHostingerMailCredentials();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'integration_credentials_removed',
    resourceType: 'integration',
    resourceId: INTEGRATION_KEYS.HOSTINGER_MAIL,
    result: 'success'
  });

  revalidatePath('/dashboard/settings/integrations');
  revalidatePath('/dashboard/email');
}

// A live proxy to the mailbox's own search, not a local index — the mailbox stays the
// authoritative copy of message content (engineering rule 2). ADMIN-only for now, same as the
// rest of this file: this reads a shared company mailbox, not team-scoped business data.
export async function searchHostingerMailbox(query: string) {
  await requireIntegrationManager();

  const credentials = await getHostingerMailCredentials();
  if (!credentials) throw new Error('Hostinger Mail is not connected');

  const result = await searchMessages(
    { apiToken: credentials.apiToken, mailboxResourceId: credentials.mailboxResourceId },
    { limit: 25 }
  );
  if (!result.ok) throw new Error(result.error);

  const needle = query.trim().toLowerCase();
  const messages = needle
    ? result.data.messages.filter(
        (m) =>
          m.from.toLowerCase().includes(needle) ||
          (m.subject ?? '').toLowerCase().includes(needle) ||
          (m.snippet ?? '').toLowerCase().includes(needle)
      )
    : result.data.messages;

  return messages;
}

export async function resolveDeadLetterEntry(id: string) {
  const caller = await requireIntegrationManager();

  await resolveDeadLetter(id, caller.id);

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'integration_dead_letter_resolved',
    resourceType: 'dead_letter_job',
    resourceId: id,
    result: 'success'
  });

  revalidatePath('/dashboard/settings/integrations');
}

// A real round-trip against the live Hostinger Mail API — the only way to actually confirm a
// pasted token/mailbox ID work, rather than just accepting whatever was typed in.
export async function testHostingerMailConnection() {
  const caller = await requireIntegrationManager();

  const [row] = await db
    .select()
    .from(integrations)
    .where(eq(integrations.key, INTEGRATION_KEYS.HOSTINGER_MAIL))
    .limit(1);
  if (!row?.credentialsEncrypted) throw new Error('No credentials saved yet');

  const credentials = await getHostingerMailCredentials();
  if (!credentials) throw new Error('No credentials saved yet');

  const result = await searchMessages(
    { apiToken: credentials.apiToken, mailboxResourceId: credentials.mailboxResourceId },
    { limit: 1 }
  );

  if (!result.ok) {
    await db
      .update(integrations)
      .set({ status: 'error', lastError: result.error, updatedAt: new Date() })
      .where(eq(integrations.key, INTEGRATION_KEYS.HOSTINGER_MAIL));
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'integration_connection_test',
      resourceType: 'integration',
      resourceId: INTEGRATION_KEYS.HOSTINGER_MAIL,
      result: 'error',
      metadata: { error: result.error }
    });
    revalidatePath('/dashboard/settings/integrations');
    throw new Error(result.error);
  }

  await db
    .update(integrations)
    .set({ status: 'connected', lastSyncAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(integrations.key, INTEGRATION_KEYS.HOSTINGER_MAIL));
  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'integration_connection_test',
    resourceType: 'integration',
    resourceId: INTEGRATION_KEYS.HOSTINGER_MAIL,
    result: 'success'
  });

  revalidatePath('/dashboard/settings/integrations');
}
