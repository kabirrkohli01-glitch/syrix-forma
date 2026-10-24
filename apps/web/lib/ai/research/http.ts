/* Outbound HTTP for the research pipeline.
 *
 * Everything SYRIX AI reads from the web comes through here, and nothing else in
 * `lib/ai/` is allowed to call `fetch` directly. The reason is that the model
 * partially chooses these URLs: a page it read can suggest another page, and a
 * question can name one. That makes this the app's server-side request forgery
 * surface, so the guard belongs at the single chokepoint rather than at each
 * call site where one omission is invisible.
 *
 * Vantage's equivalent (`src/core/http.js`) runs in a desktop process where a
 * request to a private address reaches only the operator's own machine. This
 * runs on a server that sits inside a network with a database, a queue, and a
 * cloud metadata endpoint, so the address checks below are not optional here
 * even though they were unnecessary there.
 */

import dns from 'node:dns/promises';
import net from 'node:net';

export interface FetchOptions {
  /** How long a successful response stays reusable. 0 disables caching. */
  cacheMs?: number;
  accept?: string;
  /**
   * Override the client identifier for this request.
   *
   * Exists for one reason: the SEC's public data API asks callers to identify
   * themselves and their contact address, and refuses a generic browser string.
   * Honouring that is the condition of the service being free and keyless, so it
   * is honoured rather than worked around.
   */
  userAgent?: string;
  timeoutMs?: number;
  /** Hard ceiling on the response body. A research page that exceeds it is truncated, not rejected. */
  maxBytes?: number;
}

export interface FetchResult {
  url: string;
  /** The address actually fetched, after redirects. Differs from `url` when redirected. */
  finalUrl: string;
  data: string;
  status: number;
  /** When this was retrieved from the network — not when it was served from cache. */
  at: number;
  cached: boolean;
  truncated: boolean;
}

/** Raised when a URL is refused before any connection is made. */
export class BlockedRequestError extends Error {
  readonly kind = 'blocked';
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message);
    this.name = 'BlockedRequestError';
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

/* A browser sends this; a server library that does not gets served a bot page by
   a meaningful share of sites. Identifying as a real client is not evasion — the
   pipeline still respects every block it receives (see `search.ts`). */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/* ---------- address safety ---------- */

/* Ranges that must never be reachable from a URL the model influenced.
 *
 * 169.254.169.254 is the one that matters most and the one most often missed:
 * it is the cloud instance metadata endpoint, and on an unhardened host it hands
 * out credentials to anything that asks. It is inside link-local (169.254/16),
 * which is covered below, but it is called out here so a future edit narrowing
 * that range does not silently reopen it. */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // protocol assignments / IETF
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const address = ip.toLowerCase().split('%')[0]!; // drop any zone index

  if (address === '::' || address === '::1') return true; // unspecified, loopback
  if (address.startsWith('fe8') || address.startsWith('fe9')) return true; // link-local
  if (address.startsWith('fea') || address.startsWith('feb')) return true; // link-local
  if (address.startsWith('fc') || address.startsWith('fd')) return true; // unique-local
  if (address.startsWith('ff')) return true; // multicast

  /* IPv4 written as IPv6 (::ffff:10.0.0.1) reaches exactly the same host, so it
     gets the IPv4 rules rather than being waved through as "not a v4 address". */
  const mapped = address.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]!);

  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) return isBlockedIPv6(ip);
  return true; // not an address we can reason about
}

/* Resolve a hostname and refuse it unless every address it answers with is
 * public.
 *
 * Refusing when ANY record is private — rather than when ALL are — is
 * deliberate. A host that answers with both a public and a private address is
 * either misconfigured or hostile, and picking the public one still leaves the
 * connection free to use the other.
 *
 * Residual risk, stated rather than papered over: between this check and the
 * socket opening, the name could resolve again to a different address (DNS
 * rebinding). Closing that gap completely needs connection-level pinning via a
 * custom `lookup` on an undici Agent, which is the documented hardening step
 * before this ships. The exposure meanwhile is bounded — fetched bytes are only
 * ever treated as untrusted text and the research agents that read them hold no
 * tool that can act (see `docs/forma-ai-architecture.md` §8, layer 1). */
async function assertPublicHost(hostname: string, url: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new BlockedRequestError(`Refused a request to a non-public address (${hostname}).`, url);
    }
    return;
  }

  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BlockedRequestError(`Could not resolve ${hostname}.`, url);
  }

  if (!records.length) throw new BlockedRequestError(`${hostname} resolved to nothing.`, url);

  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new BlockedRequestError(
        `Refused a request to ${hostname} — it resolves to a non-public address (${record.address}).`,
        url
      );
    }
  }
}

/* Validate a URL's shape and host. Applied to the original request and again to
   every redirect target, because redirect-to-internal is the ordinary way this
   class of control gets bypassed. */
async function assertFetchable(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BlockedRequestError('That is not a valid web address.', rawUrl);
  }

  /* Anything that is not http(s) — file:, data:, gopher:, ftp: — is refused by
     omission rather than by blocklist, so a scheme nobody thought of is refused
     too. */
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BlockedRequestError(`Refused a ${parsed.protocol} address — only http and https are fetched.`, rawUrl);
  }

  /* Credentials in a URL are never legitimate for a research fetch and are a
     known way to confuse host parsing. */
  if (parsed.username || parsed.password) {
    throw new BlockedRequestError('Refused an address carrying embedded credentials.', rawUrl);
  }

  await assertPublicHost(parsed.hostname, rawUrl);
  return parsed;
}

/* ---------- cache ---------- */

interface CacheEntry {
  result: Omit<FetchResult, 'cached'>;
  expiresAt: number;
}

/* Process-local and deliberately simple. This holds public page content only —
   never conversation content — so it is the one part of SYRIX AI that may outlive
   a chat without breaching the wipe guarantee (`docs/data-classification.md`:
   the research cache is PUBLIC). */
const cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 500;

function readCache(key: string): Omit<FetchResult, 'cached'> | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(entry.result.url);
    return null;
  }
  return entry.result;
}

function writeCache(key: string, result: Omit<FetchResult, 'cached'>, ttlMs: number): void {
  if (ttlMs <= 0) return;
  /* Oldest-first eviction. Map preserves insertion order, so the first key is
     the least recently written. */
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { result, expiresAt: Date.now() + ttlMs });
}

export function clearCache(): void {
  cache.clear();
}

/* ---------- the request ---------- */

/* Read a capped number of bytes.
 *
 * `Content-Length` is not trusted for this: it is absent on chunked responses
 * and a hostile server can simply lie. Counting what actually arrives and
 * stopping is the only cap that holds. */
async function readCapped(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body) return { text: '', truncated: false };

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const chunks: string[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(decoder.decode(value.slice(0, value.byteLength - (total - maxBytes)), { stream: false }));
        truncated = true;
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    /* Releasing before cancelling would leave the connection open on the
       truncation path, which is exactly the path a hostile server forces. */
    await reader.cancel().catch(() => {});
  }

  return { text: chunks.join(''), truncated };
}

/**
 * Fetch a URL as text, following redirects manually so every hop is re-checked.
 *
 * Sends no cookies and no credentials of any kind — `credentials: 'omit'` plus
 * manual redirect handling means nothing from the Hub's own session can reach a
 * third-party page.
 */
export async function fetchText(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
  const cacheMs = options.cacheMs ?? 0;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const cacheKey = rawUrl;
  if (cacheMs > 0) {
    const hit = readCache(cacheKey);
    if (hit) return { ...hit, cached: true };
  }

  let target = await assertFetchable(rawUrl);
  let redirects = 0;

  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(target, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          'User-Agent': options.userAgent ?? USER_AGENT,
          Accept: options.accept ?? 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9'
        }
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new Error(aborted ? `Timed out reading ${target.hostname}.` : `Could not reach ${target.hostname}.`);
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`${target.hostname} redirected without saying where.`);
      if (++redirects > MAX_REDIRECTS) throw new Error(`Too many redirects from ${target.hostname}.`);
      /* Resolved against the current target so a relative Location works, then
         re-validated from scratch — a redirect to 127.0.0.1 or to the metadata
         endpoint is refused here exactly as it would have been at the start. */
      target = await assertFetchable(new URL(location, target).toString());
      continue;
    }

    if (!response.ok) {
      const error = new Error(`${target.hostname} answered ${response.status}.`);
      /* 403/429 from a search engine means a bot control, which callers treat as
         "try the next engine" rather than as a failure worth reporting. */
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }

    const { text, truncated } = await readCapped(response, maxBytes);
    const result: Omit<FetchResult, 'cached'> = {
      url: rawUrl,
      finalUrl: target.toString(),
      data: text,
      status: response.status,
      at: Date.now(),
      truncated
    };

    writeCache(cacheKey, result, cacheMs);
    return { ...result, cached: false };
  }
}

/** Fetch and parse JSON, with the same guards. */
export async function fetchJson<T = unknown>(rawUrl: string, options: FetchOptions = {}): Promise<{ data: T; at: number; cached: boolean }> {
  const result = await fetchText(rawUrl, { ...options, accept: options.accept ?? 'application/json' });
  try {
    return { data: JSON.parse(result.data) as T, at: result.at, cached: result.cached };
  } catch {
    throw new Error(`${new URL(result.finalUrl).hostname} did not return valid JSON.`);
  }
}
