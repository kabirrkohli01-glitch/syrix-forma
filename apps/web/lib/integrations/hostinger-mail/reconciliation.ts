import { searchMessages } from './client';
import { normalizeInboundMessage, processInboundMessage } from './webhook';
import { deadLetter } from '@/lib/integrations/dead-letter';
import { INTEGRATION_KEYS } from '@/lib/integrations/keys';
import { getHostingerMailCredentials, getIntegration, recordIntegrationSyncFailure, recordIntegrationSyncSuccess } from '@/lib/integrations/settings';

const RECONCILIATION_WINDOW_MS = 60 * 60 * 1000;

// the build plan requires "webhook verification AND periodic reconciliation" specifically, not
// webhooks alone — this is what catches a message whose webhook delivery never arrived (a
// dropped connection, a Hostinger outage, this app being down when it fired). `processInboundMessage`
// is idempotent, so re-discovering a message the webhook already handled is a safe no-op, not a
// duplicate enquiry.
export async function runHostingerMailReconciliation(): Promise<void> {
  const integration = await getIntegration(INTEGRATION_KEYS.HOSTINGER_MAIL);
  const credentials = await getHostingerMailCredentials();
  if (!integration?.enabled || !credentials) {
    console.warn('[hostinger-mail/reconciliation] integration disabled or not configured — skipping');
    return;
  }

  const since = new Date(Date.now() - RECONCILIATION_WINDOW_MS).toISOString();
  const result = await searchMessages(
    { apiToken: credentials.apiToken, mailboxResourceId: credentials.mailboxResourceId },
    { since }
  );

  if (!result.ok) {
    await recordIntegrationSyncFailure(INTEGRATION_KEYS.HOSTINGER_MAIL, result.error);
    console.error('[hostinger-mail/reconciliation] search failed:', result.error);
    return;
  }

  let processed = 0;
  for (const rawMessage of result.data.messages) {
    try {
      const message = normalizeInboundMessage(rawMessage);
      const outcome = await processInboundMessage(credentials.mailboxResourceId, message);
      if (outcome.created) processed += 1;
    } catch (err) {
      await deadLetter('hostinger_mail_reconciliation', rawMessage, err);
    }
  }

  await recordIntegrationSyncSuccess(INTEGRATION_KEYS.HOSTINGER_MAIL);
  console.warn(`[hostinger-mail/reconciliation] scan complete — ${processed} new enquiry/enquiries created`);
}
