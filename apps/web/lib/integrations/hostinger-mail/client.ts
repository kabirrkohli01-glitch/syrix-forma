// Thin wrapper around the Hostinger Mail REST API (https://api.mail.hostinger.com — a real,
// documented product distinct from Hostinger's hosting-management API; see DEPENDENCIES.md).
// Bearer-token auth, one token per hPanel-connected mailbox. Every call here can fail on a
// network blip or an expired/misscoped token — none of it may throw past its caller, since a
// dead mailbox connection must degrade the Email feature only (engineering rule 2), never the
// request that happened to trigger a sync.
const REQUEST_TIMEOUT_MS = 10_000;

function getApiBaseUrl(): string {
  return process.env.HOSTINGER_MAIL_API_BASE_URL || 'https://api.mail.hostinger.com';
}

export type HostingerMailAuth = { apiToken: string; mailboxResourceId: string };

async function request<T>(
  auth: HostingerMailAuth,
  path: string,
  init: RequestInit = {}
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${auth.apiToken}`,
        'Content-Type': 'application/json',
        ...init.headers
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { ok: false, error: `Hostinger Mail API ${response.status}: ${body || response.statusText}` };
    }

    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export type HostingerMessageSummary = {
  uid: string;
  from: string;
  to: string[];
  subject: string | null;
  snippet: string | null;
  date: string;
};

export type SearchMessagesInput = {
  folder?: string;
  since?: string;
  limit?: number;
};

// Search, not a full sync — the Hub stores a reference (email_activity), the mailbox stays the
// authoritative copy. Used both by the webhook path (verifying a single message) and by
// reconciliation (catching anything a missed webhook delivery never reported).
export async function searchMessages(auth: HostingerMailAuth, input: SearchMessagesInput = {}) {
  const folder = input.folder ?? 'INBOX';
  return request<{ messages: HostingerMessageSummary[] }>(
    auth,
    `/api/v1/mailboxes/${encodeURIComponent(auth.mailboxResourceId)}/folders/${encodeURIComponent(folder)}/messages/search`,
    {
      method: 'POST',
      body: JSON.stringify({
        since: input.since,
        limit: input.limit ?? 50
      })
    }
  );
}

export type SendMessageInput = {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  inReplyTo?: string;
};

export async function sendMessage(auth: HostingerMailAuth, input: SendMessageInput) {
  return request<{ uid: string }>(auth, `/api/v1/mailboxes/${encodeURIComponent(auth.mailboxResourceId)}/send`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}
