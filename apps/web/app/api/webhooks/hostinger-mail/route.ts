import { NextResponse, type NextRequest } from 'next/server';
import { deadLetter } from '@/lib/integrations/dead-letter';
import { INTEGRATION_KEYS } from '@/lib/integrations/keys';
import { getHostingerMailCredentials, getIntegration, recordIntegrationSyncFailure, recordIntegrationSyncSuccess } from '@/lib/integrations/settings';
import { normalizeInboundMessage, processInboundMessage, verifyWebhookAuthorization } from '@/lib/integrations/hostinger-mail/webhook';

// Hostinger Mail delivers `message.received` here in real time (see DEPENDENCIES.md). Periodic
// reconciliation (worker.ts) covers anything a failed/missed delivery never reports — this route
// is the fast path, not the only path.
export async function POST(req: NextRequest) {
  const integration = await getIntegration(INTEGRATION_KEYS.HOSTINGER_MAIL);
  const credentials = await getHostingerMailCredentials();

  // 404, not 401/403 — a webhook probe against a Hub with this integration turned off should
  // learn nothing about whether it's ever been configured (same reasoning as the Access Control
  // page's 404-not-403 gate).
  if (!integration?.enabled || !credentials) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!verifyWebhookAuthorization(req.headers.get('authorization'), credentials.webhookToken)) {
    return NextResponse.json({ error: 'Invalid webhook token' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    await deadLetter('hostinger_mail_webhook', null, err);
    // Malformed JSON will never parse on retry — acknowledge so the sender stops resending it.
    return NextResponse.json({ received: true });
  }

  const event = (body as { event?: string })?.event;
  if (event && event !== 'message.received') {
    return NextResponse.json({ received: true });
  }

  const rawMessage = (body as { message?: unknown; data?: unknown })?.message ?? (body as { data?: unknown })?.data ?? body;

  try {
    const message = normalizeInboundMessage(rawMessage);
    await processInboundMessage(credentials.mailboxResourceId, message);
    await recordIntegrationSyncSuccess(INTEGRATION_KEYS.HOSTINGER_MAIL);
    return NextResponse.json({ received: true });
  } catch (err) {
    await deadLetter('hostinger_mail_webhook', body, err);
    await recordIntegrationSyncFailure(INTEGRATION_KEYS.HOSTINGER_MAIL, err instanceof Error ? err.message : String(err));
    // 500 (not 200): a transient DB/processing error is worth Hostinger's own retry, on top of
    // the dead-letter record and the periodic reconciliation pass that will also pick this up.
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
