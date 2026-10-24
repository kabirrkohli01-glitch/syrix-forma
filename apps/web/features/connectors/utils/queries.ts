import { asc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { connectors } from '@/lib/db/schema';
import { decryptIntegrationCredentials } from '@/lib/integrations/crypto';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import { canManageIntegrations } from '@/lib/permissions/integration-access';

export type ConnectorTool = { name: string; description: string | null };

/** Whether every named environment variable is set. Presence only — no value is ever read out. */
function present(...names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]));
}

/**
 * A connector as the settings screen sees it.
 *
 * Deliberately has no field that could carry the secret. `hasCredential` is a boolean because the
 * page needs to say "one is stored" and must never be able to say what it is — a shape that
 * cannot hold the secret is a stronger guarantee than a rule about not reading it.
 */
export type ConnectorRow = {
  id: string;
  kind: 'mcp' | 'http_api';
  name: string;
  baseUrl: string;
  enabled: boolean;
  status: 'unverified' | 'connected' | 'error';
  lastCheckedAt: Date | null;
  lastError: string | null;
  hasCredential: boolean;
  /** For an HTTP connector, which header the credential is sent in. Not itself a secret. */
  headerName: string | null;
  /** For an MCP server, what it reported at the last successful handshake. */
  serverName: string | null;
  tools: ConnectorTool[];
};

export async function listConnectors(caller: ActiveEmployee): Promise<ConnectorRow[]> {
  if (!canManageIntegrations(caller)) return [];

  const rows = await db.select().from(connectors).orderBy(asc(connectors.name));

  return rows.map((row) => {
    const config = (row.config ?? {}) as { serverName?: string; tools?: ConnectorTool[] };

    // Opened only to read the header name, which says where a credential is sent rather than
    // what it is. A failure here means the encryption key changed; the connector then reports as
    // having no credential, which is the honest answer — nothing can decrypt it any more.
    let headerName: string | null = null;
    let hasCredential = false;
    if (row.credentialsEncrypted) {
      try {
        const parsed = JSON.parse(decryptIntegrationCredentials(row.credentialsEncrypted)) as {
          token?: string;
          headerName?: string;
          headerValue?: string;
        };
        headerName = parsed.headerName ?? null;
        hasCredential = Boolean(parsed.token || parsed.headerValue);
      } catch {
        headerName = null;
        hasCredential = false;
      }
    }

    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      status: row.status,
      lastCheckedAt: row.lastCheckedAt,
      lastError: row.lastError,
      hasCredential,
      headerName,
      serverName: config.serverName ?? null,
      tools: Array.isArray(config.tools) ? config.tools : []
    };
  });
}

/**
 * Which infrastructure the server environment has configured.
 *
 * Presence only, never a value: this answers "is storage set up" without putting a bucket name or
 * an account id on a screen. It exists because the commonest support question about a
 * self-hosted Hub is which of its backing services are actually wired, and the honest answer is a
 * check against the environment rather than a claim in documentation.
 */
export function describeEnvironmentServices() {
  return [
    {
      key: 'database',
      name: 'Database',
      detail: 'Postgres. Everything the Hub owns lives here.',
      configured: present('DATABASE_URL')
    },
    {
      key: 'storage',
      name: 'File storage',
      detail:
        'Cloudflare R2, for Documents, HR documents and Team Chat attachments. Without it, development falls back to a local folder and a deployed Hub refuses uploads rather than losing them.',
      configured: present(
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET_NAME'
      )
    },
    {
      key: 'queue',
      name: 'Background jobs',
      detail: 'Redis, for automations, reminders and reconciliation passes.',
      configured: present('REDIS_URL')
    },
    {
      key: 'ai',
      name: 'SYRIX AI',
      detail:
        'The gateway SYRIX AI reaches its models through. Paired with scripts/pair-gateway.ts; the Hub holds a revocable device token and no provider key of its own.',
      configured: present('FORMA_AI_GATEWAY_URL') || present('SYRIX_GATEWAY_URL')
    },
    {
      key: 'errors',
      name: 'Error reporting',
      detail: 'Sentry. Off locally; never receives prompt or response text.',
      configured: present('NEXT_PUBLIC_SENTRY_DSN') || present('SENTRY_DSN')
    }
  ];
}
