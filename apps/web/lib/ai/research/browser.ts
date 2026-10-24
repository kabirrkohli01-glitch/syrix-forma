/* The sandboxed browser.
 *
 * Plain HTTP gets a research pipeline about eighty per cent of the way and then
 * stops dead. Search engines serve a challenge page to anything that is not a
 * browser, and a growing share of ordinary sites render their content with
 * JavaScript, so an HTTP fetch returns an empty shell and the model is handed
 * nothing. The alternative the industry reaches for is a paid search API. This
 * is the other alternative: drive a real browser, and pay nothing.
 *
 * WHY THIS IS NOT SIMPLY "SCRAPING WITH EXTRA STEPS". Two rules keep it honest:
 *
 *   NO BOT-DEFENCE HANDLING. If a site puts up a CAPTCHA or an interstitial, it
 *   is recorded as blocked and the next source is tried. Nothing here solves a
 *   challenge, rotates an identity to evade one, or retries to wear one down.
 *   The browser exists because pages need rendering, not because controls need
 *   circumventing.
 *
 *   THE BROWSER IS DISPOSABLE AND EMPTY. Every session gets a fresh context with
 *   no storage, no profile and no cookies carried in or out. There is no logged
 *   in state to leak and nothing persists between questions.
 *
 * SANDBOXING. The model partially chooses these URLs, so the same address rules
 * that govern `http.ts` are enforced here at the network layer via request
 * interception: every request the page makes — including ones the page itself
 * initiates, which is the part a URL check alone would miss — is resolved and
 * refused if it points anywhere private. Downloads, media, popups and service
 * workers are all off.
 *
 * IT IS OFF UNLESS A HOST SAYS OTHERWISE, and that is a deployment decision
 * rather than a retreat. `playwright-core` ships no browser binary: it drives one
 * that is already installed. That is true of a developer's machine and false of
 * an ordinary container, so leaving it on by default means the assistant's
 * behaviour depends on which machine happens to be serving the request — the one
 * thing this pass exists to remove. Set `FORMA_AI_BROWSER=on` where a Chromium is
 * genuinely installed.
 *
 * Very little is lost by it being off. The lane only ever ran as a fallback for
 * engines that serve a challenge page, and a challenge served over HTTP is
 * served to a headless browser too — which is why it is recorded and not worked
 * around. An absent browser is now reported the same way: as a lane that was not
 * available, never as a failed turn.
 */

import type { Browser, BrowserContext, Page as PlaywrightPage, Route } from 'playwright-core';
import { isBlockedAddress } from './http';
import dns from 'node:dns/promises';
import net from 'node:net';

export interface BrowseResult {
  url: string;
  finalUrl: string;
  title: string;
  html: string;
  /** True when the page presented a bot challenge. The caller moves on; nothing here solves it. */
  blocked: boolean;
  ms: number;
}

const NAV_TIMEOUT_MS = 25_000;
const IDLE_TIMEOUT_MS = 6_000;

/* Chromium is heavy to start and cheap to keep, and a research pass opens
   several pages. One instance is launched lazily and shared; contexts are what
   get thrown away per session. */
let browserPromise: Promise<Browser> | null = null;

/**
 * Whether this host is configured to drive a browser at all.
 *
 * Cheap and synchronous, so it can be checked on every search without cost —
 * unlike `browserAvailable` below, which finds out by launching one. Callers in
 * the hot path use this, so "no browser here" is a lane that was skipped rather
 * than an exception thrown in the middle of a research pass.
 */
export function browserEnabled(): boolean {
  return /^(1|on|true|yes)$/i.test(process.env.FORMA_AI_BROWSER?.trim() ?? '');
}

async function getBrowser(): Promise<Browser> {
  if (!browserEnabled()) {
    throw new Error(
      'No browser on this host. playwright-core drives an installed Chromium and does not ship one; set FORMA_AI_BROWSER=on where one exists.'
    );
  }

  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright-core');
      return chromium.launch({
        headless: true,
        args: [
          /* Chromium's own sandbox is the first line of defence and stays ON.
             The flags below remove capabilities this workload never needs. */
          '--disable-extensions',
          '--disable-plugins',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-default-apps',
          '--no-first-run',
          '--mute-audio'
        ]
      });
    })().catch((error: unknown) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => {});
}

/* Resolve a hostname and say whether it is safe to reach.
 *
 * Cached for the life of the process because a page makes dozens of requests and
 * re-resolving each one would dominate the page load. The cache is a performance
 * decision only — a name that resolved to a public address does not become
 * private mid-session in any scenario this defends against. */
const hostVerdicts = new Map<string, boolean>();

async function hostIsPublic(hostname: string): Promise<boolean> {
  if (net.isIP(hostname)) return !isBlockedAddress(hostname);

  const cached = hostVerdicts.get(hostname);
  if (cached !== undefined) return cached;

  let verdict = false;
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    verdict = records.length > 0 && records.every((record) => !isBlockedAddress(record.address));
  } catch {
    verdict = false;
  }

  hostVerdicts.set(hostname, verdict);
  return verdict;
}

/* Resource types that never carry text worth reading, and that make up most of
   a page's weight and time. Blocking them is both a speed and an attack-surface
   decision — a font or a video is a parser this process does not need to run. */
const USELESS_RESOURCES = new Set(['image', 'media', 'font', 'stylesheet']);

async function newContext(): Promise<BrowserContext> {
  const browser = await getBrowser();

  const context = await browser.newContext({
    /* No storage state, so no cookies or profile carry in. */
    storageState: undefined,
    javaScriptEnabled: true,
    acceptDownloads: false,
    bypassCSP: false,
    serviceWorkers: 'block',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  });

  context.setDefaultTimeout(NAV_TIMEOUT_MS);

  /* The sandbox proper. Every request the page makes passes through here,
     including ones the page's own scripts start — which is exactly the class a
     check on the entry URL alone would let through. */
  await context.route('**/*', async (route: Route) => {
    const request = route.request();

    if (USELESS_RESOURCES.has(request.resourceType())) return route.abort();

    let hostname: string;
    let protocol: string;
    try {
      const parsed = new URL(request.url());
      hostname = parsed.hostname;
      protocol = parsed.protocol;
    } catch {
      return route.abort();
    }

    if (protocol !== 'http:' && protocol !== 'https:') return route.abort();
    if (!(await hostIsPublic(hostname))) return route.abort();

    return route.continue();
  });

  return context;
}

/* Signals that a site is refusing automated access. Detected so the caller can
   move on and RECORD it, never so it can be worked around. */
const CHALLENGE_MARKERS = [
  /just a moment/i,
  /checking your browser/i,
  /enable javascript and cookies to continue/i,
  /verify you are (?:a )?human/i,
  /unusual traffic from your computer/i,
  /captcha/i,
  /access denied/i,
  /request blocked/i
];

function looksBlocked(title: string, html: string): boolean {
  const head = html.slice(0, 4000);
  return CHALLENGE_MARKERS.some((marker) => marker.test(title) || marker.test(head));
}

/** A browser session. Open one, use it for a research pass, always close it. */
export class BrowseSession {
  private context: BrowserContext | null = null;

  private async ensure(): Promise<BrowserContext> {
    if (!this.context) this.context = await newContext();
    return this.context;
  }

  /**
   * Navigate to a page and return its rendered HTML.
   *
   * Waits for the network to settle rather than for `load`, because the content
   * that matters on a JavaScript-rendered page usually arrives after `load`
   * fires. The settle wait is capped and failure to settle is not an error — a
   * page that keeps polling forever still has readable content by then.
   */
  async open(url: string): Promise<BrowseResult> {
    const started = Date.now();

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('That is not a valid web address.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Refused a ${parsed.protocol} address — only http and https are opened.`);
    }
    if (!(await hostIsPublic(parsed.hostname))) {
      throw new Error(`Refused to open ${parsed.hostname} — it does not resolve to a public address.`);
    }

    const context = await this.ensure();
    const page: PlaywrightPage = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT_MS }).catch(() => {});

      const html = await page.content();
      const title = await page.title().catch(() => '');

      return {
        url,
        finalUrl: page.url(),
        title,
        html,
        blocked: looksBlocked(title, html),
        ms: Date.now() - started
      };
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** Close the session. Everything it held — cookies, storage, history — goes with it. */
  async close(): Promise<void> {
    const context = this.context;
    this.context = null;
    await context?.close().catch(() => {});
  }
}

/** Whether a browser can actually be launched here — by launching one. Diagnostics only. */
export async function browserAvailable(): Promise<boolean> {
  try {
    await getBrowser();
    return true;
  } catch {
    return false;
  }
}
