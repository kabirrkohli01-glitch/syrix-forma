import { accessCodeModeEnabled } from '@/lib/auth/access-code-config';
import { Resend } from 'resend';

let cachedClient: Resend | null = null;

function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set — see .env.example');
  if (!cachedClient) cachedClient = new Resend(apiKey);
  return cachedClient;
}

export type SendEmailInput = { to: string; subject: string; body: string };
export type SendEmailResult = { ok: true } | { ok: false; error: string };

// Never throws — email is a side effect that must degrade, not cascade. A failed send is
// reported back to the caller as a result rather than an exception, so the caller decides what
// that means for it: an automation marks its own run 'failed' with this error while still
// keeping whatever DB work it already committed, rather than losing work that already
// succeeded.
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // An access-code deployment is shown to people and shares its database with the real one, so a
  // message it sent would leave a real mailbox carrying a real address. Refused here as well as
  // in preflight, which rejects the credential: this is the check that still holds if a key ever
  // arrives some other way.
  if (accessCodeModeEnabled()) {
    return { ok: false, error: 'This deployment cannot send email' };
  }

  try {
    const from = process.env.NOTIFICATIONS_FROM_EMAIL;
    if (!from) throw new Error('NOTIFICATIONS_FROM_EMAIL is not set — see .env.example');

    const client = getClient();
    const { error } = await client.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.body
    });
    if (error) throw new Error(error.message);

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[notifications/email] send failed:', message);
    return { ok: false, error: message };
  }
}
