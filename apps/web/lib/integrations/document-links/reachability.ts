import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documentLinks } from '@/lib/db/schema';
import { INTEGRATION_KEYS } from '@/lib/integrations/keys';
import { getIntegration, recordIntegrationSyncFailure, recordIntegrationSyncSuccess } from '@/lib/integrations/settings';

const REQUEST_TIMEOUT_MS = 8_000;

// This "integration" has no credentials to connect — a document link is just a URL a human
// pasted in. Reconciliation here means confirming the link is still reachable, not syncing data:
// the build plan's failure behavior for this integration is explicitly "Broken link ≠ lost
// record" — a failed check only ever updates status, the row is never touched otherwise.
async function checkReachable(url: string): Promise<{ ok: boolean; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
    // Some document hosts (SharePoint/OneDrive share links particularly) reject HEAD outright —
    // fall back to a real GET before concluding the link is broken.
    if (response.status === 405) {
      response = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
    }
    if (response.ok) return { ok: true, error: null };
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runDocumentLinkReachabilityCheck(): Promise<void> {
  const integration = await getIntegration(INTEGRATION_KEYS.MICROSOFT_365);
  if (!integration?.enabled) {
    console.warn('[document-links/reachability] integration disabled — skipping');
    return;
  }

  const links = await db.select({ id: documentLinks.id, url: documentLinks.url }).from(documentLinks);

  let brokenCount = 0;
  for (const link of links) {
    const result = await checkReachable(link.url);
    if (!result.ok) brokenCount += 1;
    await db
      .update(documentLinks)
      .set({
        lastCheckedAt: new Date(),
        lastCheckStatus: result.ok ? 'ok' : 'broken',
        lastCheckError: result.error,
        updatedAt: new Date()
      })
      .where(eq(documentLinks.id, link.id));
  }

  if (brokenCount > 0) {
    await recordIntegrationSyncFailure(INTEGRATION_KEYS.MICROSOFT_365, `${brokenCount} link(s) unreachable`);
  } else {
    await recordIntegrationSyncSuccess(INTEGRATION_KEYS.MICROSOFT_365);
  }

  console.warn(`[document-links/reachability] checked ${links.length} link(s), ${brokenCount} broken`);
}
