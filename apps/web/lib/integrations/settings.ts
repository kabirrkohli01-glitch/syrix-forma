import { eq } from 'drizzle-orm';
import { accessCodeModeEnabled } from '@/lib/auth/access-code-config';
import { db } from '@/lib/db/client';
import { integrations } from '@/lib/db/schema';
import { decryptIntegrationCredentials, encryptIntegrationCredentials } from './crypto';
import { INTEGRATION_KEYS, type IntegrationKey } from './keys';

export type IntegrationRow = typeof integrations.$inferSelect;

/**
 * Whether this deployment is allowed to act on a third-party account at all.
 *
 * An integration's credentials live in the database, not in the environment, so a deployment that
 * shares a database with another one inherits every connection that other one has made — and a
 * demonstration Hub opened with a shared code would inherit the ability to read and send from a
 * real mailbox. That is the one thing it must not be able to do, whoever is holding the code.
 *
 * Enforced here rather than by leaving the switch off in the interface, because the switch is in
 * the same shared database: anyone who reached the settings screen could turn it back on.
 */
function integrationsPermitted(): boolean {
  return !accessCodeModeEnabled();
}

export async function getIntegration(key: IntegrationKey): Promise<IntegrationRow | undefined> {
  const [row] = await db.select().from(integrations).where(eq(integrations.key, key)).limit(1);
  if (!row) return row;

  // The row is still returned so the Integrations screen can render its name and explain itself,
  // rather than showing an empty page — but never as enabled, and never with credentials.
  if (!integrationsPermitted()) {
    return { ...row, enabled: false, credentialsEncrypted: null };
  }
  return row;
}

// Fail closed: a missing row (migration not yet run) is treated as disabled, never as enabled.
export async function isIntegrationEnabled(key: IntegrationKey): Promise<boolean> {
  if (!integrationsPermitted()) return false;
  const row = await getIntegration(key);
  return row?.enabled ?? false;
}

export async function recordIntegrationSyncSuccess(key: IntegrationKey): Promise<void> {
  await db
    .update(integrations)
    .set({ status: 'connected', lastSyncAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(integrations.key, key));
}

// Never disables the integration on a failed sync — a transient error degrades that one
// feature (the build plan's "degrades independently"), it doesn't flip the switch someone
// explicitly turned on.
export async function recordIntegrationSyncFailure(key: IntegrationKey, error: string): Promise<void> {
  await db
    .update(integrations)
    .set({ status: 'error', lastError: error, updatedAt: new Date() })
    .where(eq(integrations.key, key));
}

export type HostingerMailCredentials = {
  apiToken: string;
  mailboxResourceId: string;
  webhookToken: string;
};

export async function getHostingerMailCredentials(): Promise<HostingerMailCredentials | null> {
  const row = await getIntegration(INTEGRATION_KEYS.HOSTINGER_MAIL);
  if (!row?.credentialsEncrypted) return null;
  return JSON.parse(decryptIntegrationCredentials(row.credentialsEncrypted)) as HostingerMailCredentials;
}

export async function setHostingerMailCredentials(creds: HostingerMailCredentials): Promise<void> {
  // Writing is blocked as well as reading. Both deployments share one row, so a credential saved
  // from the demonstration Hub would become the credential the real one uses.
  if (!integrationsPermitted()) {
    throw new Error('Integrations cannot be configured on an access-code deployment');
  }
  const encrypted = encryptIntegrationCredentials(JSON.stringify(creds));
  await db
    .update(integrations)
    .set({ credentialsEncrypted: encrypted, status: 'not_configured', updatedAt: new Date() })
    .where(eq(integrations.key, INTEGRATION_KEYS.HOSTINGER_MAIL));
}

export async function clearHostingerMailCredentials(): Promise<void> {
  await db
    .update(integrations)
    .set({
      credentialsEncrypted: null,
      enabled: false,
      status: 'not_configured',
      lastError: null,
      updatedAt: new Date()
    })
    .where(eq(integrations.key, INTEGRATION_KEYS.HOSTINGER_MAIL));
}
