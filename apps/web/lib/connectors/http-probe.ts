/**
 * A single authenticated request that proves a stored credential actually works.
 *
 * The point of this file is that "Connected" should mean the service answered, not that somebody
 * pasted something into a box. A connector page whose status reflects only what was typed is a
 * connector page that reports every expired token as healthy, and the first anyone knows of it is
 * the feature that depended on it failing silently.
 *
 * No response body is returned to the caller. A verification only ever yields "it answered" or a
 * sentence saying how it did not — the body of someone's Slack or Notion account has no business
 * being rendered on a settings screen, and returning it would put third-party content in front of
 * a reader who has no reason to expect it (engineering rule 12).
 */

import { describeUrlProblem } from './url-guard';

const REQUEST_TIMEOUT_MS = 10_000;

export type HttpProbeResult = { ok: true } | { ok: false; error: string };

export async function probeHttpEndpoint(input: {
  url: string;
  headers: Record<string, string>;
  method?: 'GET' | 'POST';
  /**
   * Some APIs answer 200 with `{"ok": false}` for a bad token rather than 401 — Slack is the
   * well-known one. Where that is true, the caller supplies a check over the decoded body.
   */
  validateBody?: (body: unknown) => string | null;
}): Promise<HttpProbeResult> {
  // Same guard the form applied, applied again at the point of the request — see url-guard.ts.
  const problem = describeUrlProblem(input.url);
  if (problem) return { ok: false, error: problem };
  const url = new URL(input.url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: input.method ?? 'GET',
      headers: { accept: 'application/json', ...input.headers },
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'follow'
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'The service rejected that credential. Check it was copied in full.' };
    }
    if (!response.ok) {
      return { ok: false, error: `The service answered ${response.status} ${response.statusText}` };
    }

    if (input.validateBody) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        return { ok: false, error: 'The service answered with something that was not JSON' };
      }
      const problem = input.validateBody(body);
      if (problem) return { ok: false, error: problem };
    }

    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'The service did not answer within 10 seconds' };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The service could not be reached'
    };
  } finally {
    clearTimeout(timer);
  }
}
