'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { accessCodeModeEnabled } from '@/lib/auth/access-code-config';
import { db } from '@/lib/db/client';
import { connectors } from '@/lib/db/schema';
import { isUniqueViolation } from '@/lib/db/unique-violation';
import { probeHttpEndpoint } from '@/lib/connectors/http-probe';
import { probeMcpServer } from '@/lib/connectors/mcp-client';
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials
} from '@/lib/integrations/crypto';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { canManageIntegrations } from '@/lib/permissions/integration-access';
import { checkRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit';
import { ConnectorError } from './utils/errors';
import {
  saveHttpConnectorSchema,
  saveMcpConnectorSchema,
  type SaveHttpConnectorInput,
  type SaveMcpConnectorInput
} from './utils/schemas';

/**
 * Connectors hold credentials to systems outside the organisation, so this is ADMIN plus a fresh authenticator
 * code — the same bar as changing an integration or granting a permission, and for the same
 * reason: a stolen session should not be enough to point the Hub's server at an address of the
 * attacker's choosing and read back what it finds.
 */
async function requireConnectorAdmin() {
  // Every action behind this gate either points the Hub's server at an address the caller typed
  // or stores a credential in a database the real deployment also reads. Neither belongs to a
  // Hub whose front door is a code shared with an audience, so the mode is refused outright
  // rather than relying on the permission check — which passes, because everyone holding the
  // code is the same administrator.
  if (accessCodeModeEnabled()) {
    throw new ConnectorError('Connectors cannot be changed from an access-code deployment.');
  }

  const caller = await requireActiveEmployee();
  if (!canManageIntegrations(caller)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'connector_denied',
      resourceType: 'connector',
      result: 'denied'
    });
    throw new ConnectorError(
      'Only an administrator can add or change connectors. Ask one to do it in Settings → Connectors.'
    );
  }
  return caller;
}

type StoredCredentials = { token?: string; headerName?: string; headerValue?: string };

function readCredentials(row: typeof connectors.$inferSelect): StoredCredentials {
  if (!row.credentialsEncrypted) return {};
  try {
    return JSON.parse(decryptIntegrationCredentials(row.credentialsEncrypted)) as StoredCredentials;
  } catch {
    // A credential that will not decrypt means the encryption key changed. Treated as absent so
    // the connector reports as unverified and can be re-entered, rather than throwing on a page
    // load and taking the whole settings screen down with it.
    return {};
  }
}

function writeCredentials(values: StoredCredentials): string | null {
  const present = Object.values(values).some((value) => value && value.length > 0);
  return present ? encryptIntegrationCredentials(JSON.stringify(values)) : null;
}

/**
 * Verifies a connector against the live service and records the outcome.
 *
 * Called on every save as well as on demand, because "Connected" has to mean the service answered
 * rather than that something was typed. A save whose verification fails is still saved — the
 * credential may be right and the service temporarily down — but it is saved as `error` with the
 * reason attached, never as connected.
 */
async function verify(
  callerId: string,
  row: typeof connectors.$inferSelect
): Promise<{ ok: boolean; error?: string }> {
  // Every path through here makes the server issue an outbound request to an address the caller
  // supplied. The URL guard decides *where* it may go; this decides how often, so a loop cannot
  // turn the Hub into a scanner however narrow the permitted target set is.
  const limit = await checkRateLimit(
    `connector-test:${callerId}`,
    RATE_LIMITS.connectorTest.limit,
    RATE_LIMITS.connectorTest.windowSeconds
  );
  if (!limit.allowed) {
    return {
      ok: false,
      error: `That is a lot of checks at once. Try again in ${limit.retryAfterSeconds} seconds.`
    };
  }

  const credentials = readCredentials(row);

  if (row.kind === 'mcp') {
    const result = await probeMcpServer({
      baseUrl: row.baseUrl,
      authorizationHeader: credentials.token ? `Bearer ${credentials.token}` : undefined
    });

    if (!result.ok) return { ok: false, error: result.error };

    await db
      .update(connectors)
      .set({
        // Tool names and descriptions come from the server and are stored to be displayed, never
        // executed and never placed anywhere that treats text as an instruction.
        config: {
          serverName: result.serverName,
          serverVersion: result.serverVersion,
          protocolVersion: result.protocolVersion,
          tools: result.tools
        },
        updatedAt: new Date()
      })
      .where(eq(connectors.id, row.id));

    return { ok: true };
  }

  if (!credentials.headerName || !credentials.headerValue) {
    return { ok: false, error: 'No credential has been saved for this connector yet' };
  }

  const result = await probeHttpEndpoint({
    url: row.baseUrl,
    headers: { [credentials.headerName]: credentials.headerValue }
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

async function recordVerification(connectorId: string, outcome: { ok: boolean; error?: string }) {
  await db
    .update(connectors)
    .set({
      status: outcome.ok ? 'connected' : 'error',
      lastCheckedAt: new Date(),
      lastError: outcome.ok ? null : (outcome.error ?? 'The check failed'),
      updatedAt: new Date()
    })
    .where(eq(connectors.id, connectorId));
}

export async function saveMcpConnector(input: SaveMcpConnectorInput) {
  const caller = await requireConnectorAdmin();
  const parsed = saveMcpConnectorSchema.parse(input);

  const existing = parsed.connectorId ? await loadConnector(parsed.connectorId) : null;

  // An omitted token on an update means "leave it alone", which is what lets the form show a
  // saved connector without ever sending the secret back to the browser to be re-submitted.
  const previous = existing ? readCredentials(existing) : {};
  const token = parsed.token === undefined ? previous.token : parsed.token || undefined;

  const values = {
    kind: 'mcp' as const,
    name: parsed.name,
    catalogueKey: 'mcp',
    baseUrl: parsed.baseUrl,
    credentialsEncrypted: writeCredentials({ token }),
    createdByEmployeeId: caller.id,
    updatedAt: new Date()
  };

  const id = existing
    ? (await db.update(connectors).set(values).where(eq(connectors.id, existing.id)).returning({ id: connectors.id }))[0]
        .id
    : (await insertConnector(values, parsed.name)).id;

  const row = await loadConnector(id);
  const outcome = await verify(caller.id, row);
  await recordVerification(id, outcome);

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: existing ? 'connector_updated' : 'connector_created',
    resourceType: 'connector',
    resourceId: id,
    result: outcome.ok ? 'success' : 'error',
    // The URL is recorded; the token never is (engineering rule 11).
    metadata: { kind: 'mcp', baseUrl: parsed.baseUrl, verified: outcome.ok }
  });

  revalidatePath('/dashboard/settings/connectors');
  return { connectorId: id, verified: outcome.ok, error: outcome.error };
}

export async function saveHttpConnector(input: SaveHttpConnectorInput) {
  const caller = await requireConnectorAdmin();
  const parsed = saveHttpConnectorSchema.parse(input);

  const existing = parsed.connectorId ? await loadConnector(parsed.connectorId) : null;
  const previous = existing ? readCredentials(existing) : {};
  const headerValue =
    parsed.headerValue === undefined ? previous.headerValue : parsed.headerValue || undefined;

  const values = {
    kind: 'http_api' as const,
    name: parsed.name,
    catalogueKey: 'http_api',
    baseUrl: parsed.baseUrl,
    credentialsEncrypted: writeCredentials({ headerName: parsed.headerName, headerValue }),
    createdByEmployeeId: caller.id,
    updatedAt: new Date()
  };

  const id = existing
    ? (await db.update(connectors).set(values).where(eq(connectors.id, existing.id)).returning({ id: connectors.id }))[0]
        .id
    : (await insertConnector(values, parsed.name)).id;

  const row = await loadConnector(id);
  const outcome = await verify(caller.id, row);
  await recordVerification(id, outcome);

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: existing ? 'connector_updated' : 'connector_created',
    resourceType: 'connector',
    resourceId: id,
    result: outcome.ok ? 'success' : 'error',
    metadata: {
      kind: 'http_api',
      baseUrl: parsed.baseUrl,
      headerName: parsed.headerName,
      verified: outcome.ok
    }
  });

  revalidatePath('/dashboard/settings/connectors');
  return { connectorId: id, verified: outcome.ok, error: outcome.error };
}

export async function testConnector(connectorId: string) {
  const caller = await requireConnectorAdmin();
  const row = await loadConnector(connectorId);

  const outcome = await verify(caller.id, row);
  await recordVerification(connectorId, outcome);

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'connector_tested',
    resourceType: 'connector',
    resourceId: connectorId,
    result: outcome.ok ? 'success' : 'error',
    metadata: { kind: row.kind, verified: outcome.ok }
  });

  revalidatePath('/dashboard/settings/connectors');
  return { verified: outcome.ok, error: outcome.error };
}

export async function setConnectorEnabled(connectorId: string, enabled: boolean) {
  const caller = await requireConnectorAdmin();
  const row = await loadConnector(connectorId);

  await db
    .update(connectors)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(connectors.id, connectorId));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'connector_enabled_changed',
    resourceType: 'connector',
    resourceId: connectorId,
    result: 'success',
    metadata: { name: row.name, enabled }
  });

  revalidatePath('/dashboard/settings/connectors');
}

/**
 * Removes the connector and its stored credential outright.
 *
 * Deleted rather than archived, unlike documents: what is being removed here is a live secret,
 * and the reason to remove one is usually that it should no longer exist. Keeping a disconnected
 * copy of a token nobody intends to use again is the opposite of what was asked for.
 */
export async function deleteConnector(connectorId: string) {
  const caller = await requireConnectorAdmin();
  const row = await loadConnector(connectorId);

  await db.delete(connectors).where(eq(connectors.id, connectorId));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'connector_deleted',
    resourceType: 'connector',
    resourceId: connectorId,
    result: 'success',
    metadata: { name: row.name, kind: row.kind }
  });

  revalidatePath('/dashboard/settings/connectors');
}

async function loadConnector(connectorId: string) {
  const [row] = await db.select().from(connectors).where(eq(connectors.id, connectorId)).limit(1);
  if (!row) throw new ConnectorError('That connector no longer exists');
  return row;
}

async function insertConnector(
  values: Omit<typeof connectors.$inferInsert, 'name'>,
  name: string
) {
  try {
    const [created] = await db
      .insert(connectors)
      .values({ ...values, name })
      .returning({ id: connectors.id });
    return created;
  } catch (error) {
    if (isUniqueViolation(error, 'connectors_name_unique')) {
      throw new ConnectorError(`There is already a connector called "${name}"`);
    }
    throw error;
  }
}
