/* Finding pages, without an account or a key.
 *
 * Ported from Vantage's `src/syrix/websearch.js`, with the parts that matter for
 * immigration work added: an authoritative-source adapter that goes to the
 * publisher directly, and an authority tier attached to every result so the
 * answer can say how much weight a source carries.
 *
 * ENGINES ARE TRIED IN ORDER, FIRST ONE THAT ANSWERS WINS. They are not merged.
 * Three engines' idea of the same ten pages says less than one engine's, not
 * more, and merging mostly produces duplicates wearing different titles.
 *
 * NO BOT-DEFENCE HANDLING. An engine that puts up a challenge is recorded as
 * blocked and the next one is tried. Nothing here works around a control.
 *
 * Every result carries the URL it came from, because an answer built on a page
 * has to be able to name the page.
 */

import { fetchJson, fetchText } from './http';

export type Authority =
  /** The body that makes or administers the rule. */
  | 'official'
  /** Courts, tribunals, statutory bodies, intergovernmental organisations. */
  | 'legal'
  /** Regulated professions, universities, established news organisations. */
  | 'reputable'
  /** Everything else — forums, blogs, content farms, unknown domains. */
  | 'unverified';

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  engine: string;
  authority: Authority;
  /** Publisher's own timestamp where the source provides one. Immigration rules change; undated is a finding. */
  publishedAt?: string;
}

export interface SearchOutcome {
  query: string;
  engine: string | null;
  results: SearchResult[];
  attempts: { engine: string; outcome: string; message?: string }[];
  note?: string;
}

const MAX_PER_DOMAIN = 2;
/* Effectively uncapped for a primary publisher: one domain is not one source.
 *
 * The cap used to be applied here, in the ENGINE'S order, which on GOV.UK is a
 * bad order — the page titled "Indefinite leave to remain if you've been in the
 * UK for 10 years" came back eighth for that exact question. Trimming to six at
 * this point discarded it before anything could score it. Candidates stay wide
 * here and are trimmed after ranking, in `relevance.selectSources`. */
const MAX_PER_OFFICIAL_DOMAIN = 20;
const MAX_RESULTS = 30;
const SEARCH_CACHE_MS = 10 * 60 * 1000;

/* ---------- authority ---------- */

/* Domains whose word is the rule itself, not a report of it.
 *
 * Kept as suffix matches so `www.gov.uk` and `assets.publishing.service.gov.uk`
 * both qualify without listing every subdomain. Deliberately short: a list that
 * tries to enumerate every credible immigration site becomes a list nobody
 * trusts. Anything not named here is `unverified`, and the answer says so. */
const OFFICIAL_SUFFIXES = [
  'gov.uk',
  'service.gov.uk',
  'homeoffice.gov.uk',
  'ukvi.homeoffice.gov.uk',
  'gov.ie',
  'canada.ca',
  'cic.gc.ca',
  'uscis.gov',
  'state.gov',
  'travel.state.gov',
  'homeaffairs.gov.au',
  'immi.homeaffairs.gov.au',
  'immigration.govt.nz',
  'europa.eu',
  'schengenvisainfo.ec.europa.eu'
];

const LEGAL_SUFFIXES = [
  'legislation.gov.uk',
  'judiciary.uk',
  'bailii.org',
  'tribunals.gov.uk',
  'supremecourt.uk',
  'parliament.uk',
  'unhcr.org',
  'iom.int',
  'echr.coe.int'
];

const REPUTABLE_SUFFIXES = [
  'lawsociety.org.uk',
  'barcouncil.org.uk',
  'ilpa.org.uk',
  'freemovement.org.uk',
  'jcwi.org.uk',
  'migrationobservatory.ox.ac.uk',
  'bbc.co.uk',
  'ft.com',
  'thetimes.co.uk',
  'theguardian.com',
  'reuters.com',
  'ac.uk'
];

function matchesSuffix(domain: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => domain === suffix || domain.endsWith('.' + suffix));
}

export function authorityOf(url: string): Authority {
  const domain = domainOf(url);
  if (!domain) return 'unverified';
  if (matchesSuffix(domain, OFFICIAL_SUFFIXES)) return 'official';
  if (matchesSuffix(domain, LEGAL_SUFFIXES)) return 'legal';
  if (matchesSuffix(domain, REPUTABLE_SUFFIXES)) return 'reputable';
  return 'unverified';
}

/* ---------- text helpers ---------- */

function decodeEntities(text: string): string {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

export function stripTags(html: string): string {
  return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/* One engine wraps every result in its own redirect. Unwrapping it matters:
   left alone, every source in an answer reports as that engine's domain rather
   than as the site the words actually came from. */
export function unwrap(href: string): string {
  const raw = String(href || '');
  const match = raw.match(/[?&]uddg=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]!);
    } catch {
      return raw;
    }
  }
  if (raw.startsWith('//')) return 'https:' + raw;
  return raw;
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function usable(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  const domain = domainOf(url);
  if (!domain) return false;
  /* An engine's own help and settings pages are not results. */
  return !/^(duckduckgo\.com|bing\.com|go\.microsoft\.com|r\.search\.yahoo\.com|mojeek\.com)$/i.test(domain);
}

/* Keep the list varied. Ten pages from one site is one source, and an answer
 * built on it is a single-source answer wearing a bibliography.
 *
 * Ordering deliberately does NOT happen here. An earlier version sorted by
 * authority at this point, and it made results worse: asked for the Skilled
 * Worker salary threshold, GOV.UK's own index returned "Check if you need a UK
 * visa" and "Tax-Free Childcare", and sorting by authority promoted both above
 * the pages that actually carried the figure. Relevance has to come first and
 * authority has to be a bonus on top of it, which needs the question — so
 * ranking lives in `relevance.ts` and callers apply it. This function only
 * decides which results survive, not what order they are read in. */
function diversify(results: SearchResult[]): SearchResult[] {
  const counts: Record<string, number> = Object.create(null);
  const out: SearchResult[] = [];

  for (const result of results) {
    const domain = domainOf(result.url);
    if (!domain) continue;
    counts[domain] = (counts[domain] ?? 0) + 1;

    /* The cap exists to stop one site's ten pages passing for ten sources. That
       reasoning does not apply to the publisher of the rule: a UK immigration
       question is answered by several pages that all live on gov.uk, and a cap
       of two silently discarded the right one. Applying the same limit to a
       primary source confuses "one domain" with "one source" — for an official
       publisher those are different things. */
    const limit = result.authority === 'official' || result.authority === 'legal'
      ? MAX_PER_OFFICIAL_DOMAIN
      : MAX_PER_DOMAIN;

    if (counts[domain]! > limit) continue;
    if (out.some((existing) => existing.url === result.url)) continue;
    out.push(result);
  }

  return out;
}

/* ---------- gov.uk, queried directly ---------- */

interface GovUkSearchResponse {
  results?: {
    title?: string;
    description?: string;
    link?: string;
    public_timestamp?: string;
    format?: string;
  }[];
}

/* GOV.UK publishes a keyless search API over its own index.
 *
 * This is the single largest accuracy win available to this pipeline. A general
 * engine asked for a salary threshold returns immigration firms' blog posts
 * about the threshold, which are often a year stale and are written to rank
 * rather than to be right. This returns the page the Home Office publishes,
 * with the publisher's own timestamp attached, so "as at" is a fact rather than
 * an inference. It is queried alongside general search rather than instead,
 * because it only covers UK government content. */
/* Departments whose content answers this domain's questions.
 *
 * GOV.UK indexes every department, so an immigration query competes against the
 * whole of government on term overlap alone. Asked about long residence
 * absences it returned "Tax on foreign income" first and "Renew your driving
 * licence" eighth — pages that share ordinary words with the question and
 * nothing else. Restricting to the publishing department is the publisher's own
 * metadata doing what no lexical scorer can: it is not a guess about relevance,
 * it is a fact about who wrote the page. */
const IMMIGRATION_ORGANISATIONS = ['uk-visas-and-immigration', 'home-office'];

async function govUkQuery(query: string, organisation?: string): Promise<SearchResult[]> {
  /* Deliberately wide, because GOV.UK's own relevance ordering is weak and this
     pipeline can rank better than it does.
     Asked for "indefinite leave to remain 10 year long residence rules", GOV.UK
     returned "Tax on foreign income" first and put the page actually titled
     "Indefinite leave to remain if you've been in the UK for 10 years (long
     residence)" eighth. Requesting six results dropped the right answer before
     anything could score it. Fetching wide and re-ranking locally
     (`relevance.ts`) turns their ordering into a candidate set, which is all it
     is reliable enough to be. */
  const url =
    'https://www.gov.uk/api/search.json?count=20&q=' +
    encodeURIComponent(query) +
    (organisation ? '&filter_organisations=' + encodeURIComponent(organisation) : '');

  const { data } = await fetchJson<GovUkSearchResponse>(url, { cacheMs: SEARCH_CACHE_MS });

  return (data.results ?? [])
    .filter((row) => row.link)
    .map((row) => {
      /* `link` is a path for site content and an absolute URL for attachments. */
      const link = row.link!;
      const url = link.startsWith('http') ? link : 'https://www.gov.uk' + link;
      return {
        url,
        title: row.title?.trim() || url,
        snippet: row.description?.trim() ?? '',
        engine: 'gov.uk',
        authority: authorityOf(url),
        publishedAt: row.public_timestamp
      };
    })
    .filter((result) => usable(result.url));
}

/* The department-scoped queries run ALONGSIDE the unscoped one, not instead of
 * it. Scoping raises the density of relevant candidates, but the organisation's questions are
 * not all immigration questions, and a scoped-only search would answer an
 * employment-law or company-filing question with nothing at all. Merging keeps
 * recall while making it far likelier that the pages which answer the common
 * case are in the pool at all. Duplicates are removed by URL downstream. */
async function govUk(query: string): Promise<SearchResult[]> {
  const lanes = await Promise.all([
    govUkQuery(query),
    ...IMMIGRATION_ORGANISATIONS.map((org) => govUkQuery(query, org).catch(() => [] as SearchResult[]))
  ]);

  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  /* Scoped results lead: within one publisher's own content, GOV.UK's ordering
     is competing over a far more relevant set, so its first choices are worth
     more than its first choices across all of government. */
  for (const lane of [...lanes.slice(1), lanes[0]]) {
    for (const result of lane) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      merged.push(result);
    }
  }

  return merged;
}

/* ---------- general engines ---------- */

/* Each engine is a URL to visit and a parser for what comes back, deliberately
 * separated from HOW the page is retrieved. The same parser then serves both
 * transports: a plain HTTP fetch, and — when that is refused — the sandboxed
 * browser. Without the split the browser fallback would need a duplicate copy of
 * every parser, and the two would drift the first time an engine changed its
 * markup. */
interface Engine {
  name: string;
  url: (query: string) => string;
  parse: (html: string) => SearchResult[];
}

/* The class attribute on a result block is a LIST — "links_main links_deep
   result__body" — so the marker is matched anywhere inside it rather than as the
   whole value. Anchoring on `class="result__body"` matched nothing at all,
   silently, and every search fell through to the next engine. */
const duckduckgo: Engine = {
  name: 'duckduckgo',
  url: (query) => 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query),
  parse: (html) => {
    const out: SearchResult[] = [];
    for (const block of html.split(/class="[^"]*result__body[^"]*"/).slice(1)) {
      const link = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!link) continue;
      const url = unwrap(decodeEntities(link[1]!));
      if (!usable(url)) continue;
      const snippet = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      out.push({
        url,
        title: stripTags(link[2]!),
        snippet: snippet ? stripTags(snippet[1]!) : '',
        engine: 'duckduckgo',
        authority: authorityOf(url)
      });
    }
    return out;
  }
};

/* The same index behind different markup. Not an independent opinion, but when
   the HTML endpoint is challenged this one frequently is not, and a working
   fallback to the same index beats no results at all. */
const duckduckgoLite: Engine = {
  name: 'duckduckgo-lite',
  url: (query) => 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query),
  parse: (html) => {
    const out: SearchResult[] = [];
    const pattern = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const url = unwrap(decodeEntities(match[1]!));
      if (!usable(url)) continue;
      out.push({
        url,
        title: stripTags(match[2]!),
        snippet: '',
        engine: 'duckduckgo-lite',
        authority: authorityOf(url)
      });
    }
    return out;
  }
};

/* An independent crawler with its own index, so it is a genuinely different
 * answer rather than the same one relabelled.
 *
 * The obvious alternative — a large engine's RSS endpoint — was tried and
 * rejected in the earlier implementation: asked who the prime minister is, it
 * returned four pages about Amazon Prime Video. An engine that answers a
 * different question to the one asked is worse than no fallback, because the
 * assistant would cite it. */
const mojeek: Engine = {
  name: 'mojeek',
  url: (query) => 'https://www.mojeek.com/search?q=' + encodeURIComponent(query),
  parse: (html) => {
    const out: SearchResult[] = [];
    for (const block of html.split(/<li class="r\d+">/).slice(1)) {
      const link = block.match(/<a class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!link) continue;
      const url = decodeEntities(link[1]!);
      if (!usable(url)) continue;
      const snippet = block.match(/<p class="s">([\s\S]*?)<\/p>/);
      out.push({
        url,
        title: stripTags(link[2]!),
        snippet: snippet ? stripTags(snippet[1]!) : '',
        engine: 'mojeek',
        authority: authorityOf(url)
      });
    }
    return out;
  }
};

/* A challenge page is a 200 with no results in it, which is indistinguishable
 * from a genuine empty result set unless you look for the challenge.
 *
 * Reporting "no results" for a refusal was actively misleading: it reads as "the
 * web has nothing on this", when what happened is that nobody was allowed to
 * look. The distinction matters to whoever reads the answer, so it is detected
 * and named. Detection exists to REPORT and move on — nothing here solves a
 * challenge, and nothing retries one to wear it down. */
const CHALLENGE_MARKERS = [
  /bots use duckduckgo too/i,
  /confirm this search was made by a human/i,
  /complete the following challenge/i,
  /javascript is required to complete this challen/i,
  /captcha/i,
  /unusual traffic/i,
  /verify you are (?:a )?human/i,
  /access denied/i
];

export function looksChallenged(html: string): boolean {
  const head = html.slice(0, 6000);
  return CHALLENGE_MARKERS.some((marker) => marker.test(head));
}

/* An engine that just refused us is skipped for a while rather than retried on
   every query, which is what made a three-query research pass spend twelve
   seconds being turned away nine times. */
const engineCooldown = new Map<string, number>();
const ENGINE_COOLDOWN_MS = 10 * 60 * 1000;

function engineIsCooling(name: string): boolean {
  const until = engineCooldown.get(name);
  if (!until) return false;
  if (Date.now() > until) {
    engineCooldown.delete(name);
    return false;
  }
  return true;
}

const ENGINES: Engine[] = [duckduckgo, duckduckgoLite, mojeek];

/* ---------- sources that welcome being queried ---------- */

/* A self-hosted SearXNG, when one is configured.
 *
 * This is the answer to general web search without paying and without fighting
 * anybody's bot defence: SearXNG aggregates engines through their own
 * interfaces and returns JSON, so there is no challenge to be served and no
 * per-query cost. It is off unless SEARXNG_URL is set, because it needs to be
 * run somewhere — see docs/forma-ai-architecture.md. Run it with:
 *
 *   docker run -d -p 8888:8080 -e SEARXNG_BASE_URL=http://localhost:8888/ searxng/searxng
 *
 * then set SEARXNG_URL=http://localhost:8888 */
async function searxng(query: string): Promise<SearchResult[]> {
  const base = process.env.SEARXNG_URL?.trim();
  if (!base) return [];

  const { data } = await fetchJson<{ results?: { url?: string; title?: string; content?: string; publishedDate?: string }[] }>(
    base.replace(/\/$/, '') + '/search?format=json&language=en-GB&q=' + encodeURIComponent(query),
    { cacheMs: SEARCH_CACHE_MS }
  );

  return (data.results ?? [])
    .filter((row) => row.url)
    .map((row) => ({
      url: row.url!,
      title: row.title?.trim() || row.url!,
      snippet: row.content?.trim() ?? '',
      engine: 'searxng',
      authority: authorityOf(row.url!),
      publishedAt: row.publishedDate
    }))
    .filter((result) => usable(result.url));
}

/* Wikipedia, queried directly rather than through an engine.
 *
 * It answers definitional and background questions with one citable article
 * instead of ten pages that each quote it, and it has a real API that expects to
 * be called. For country-conditions questions — which is half of what this
 * assistant is for — it is genuinely useful rather than a consolation prize. */
async function wikipedia(query: string): Promise<SearchResult[]> {
  const { data } = await fetchJson<{ query?: { search?: { title?: string; snippet?: string; timestamp?: string }[] } }>(
    'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=' +
      encodeURIComponent(query),
    { cacheMs: 6 * 60 * 60 * 1000 }
  );

  return (data.query?.search ?? [])
    .filter((row) => row.title)
    .map((row) => {
      const url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(row.title!.replace(/ /g, '_'));
      return {
        url,
        title: row.title!,
        snippet: stripTags(row.snippet ?? ''),
        engine: 'wikipedia',
        /* Derived like every other lane's, rather than asserted here.
         *
         * This lane used to declare its results `reputable` while `authorityOf`
         * — which is what `read-page.ts` applies once the page is fetched —
         * calls the same domain `unverified`. One source carried two different
         * standings depending on which stage was looking at it: the answer
         * prompt was told to weigh it as an established organisation, the
         * citation under the answer said it was unverified, and a filter on
         * standing let it through at selection and caught it after reading.
         *
         * `unverified` is the honest one. The tiers here mean the body that
         * makes a rule, a court, or an established newsroom — an encyclopaedia
         * is a summary of those, and a good one, but it is not any of them. */
        authority: authorityOf(url),
        publishedAt: row.timestamp
      };
    });
}

/* Recent stories from named publishers. The list of feeds, why it is a fixed
   list, and what it refuses to read live in `./news` — imported lazily so a
   question that is not about the news does not pay for the module. */
async function newsLane(query: string): Promise<SearchResult[]> {
  const { searchNews } = await import('./news');
  const items = await searchNews(query);

  return items.map((item) => ({
    url: item.url,
    /* The publisher is put in the label rather than left to the domain, because
       the label is what appears beside the claim in the answer. */
    title: `${item.title} — ${item.engine}`,
    snippet: item.snippet,
    engine: 'news',
    authority: item.authority,
    publishedAt: item.publishedAt
  }));
}

/* UK primary legislation, which publishes a real search interface. */
async function legislation(query: string): Promise<SearchResult[]> {
  const res = await fetchText(
    'https://www.legislation.gov.uk/all/data.feed?text=' + encodeURIComponent(query),
    { cacheMs: SEARCH_CACHE_MS, accept: 'application/atom+xml' }
  );

  const out: SearchResult[] = [];
  for (const entry of res.data.split('<entry>').slice(1, 6)) {
    const title = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1];
    const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1];
    const updated = entry.match(/<updated>([^<]+)<\/updated>/)?.[1];
    if (!link || !title) continue;
    const url = link.startsWith('http') ? link : 'https://www.legislation.gov.uk' + link;
    out.push({
      url,
      title: stripTags(title),
      snippet: '',
      engine: 'legislation.gov.uk',
      authority: authorityOf(url),
      publishedAt: updated
    });
  }
  return out;
}


export interface SearchOptions {
  limit?: number;
  /** Query GOV.UK's own index alongside general search. Defaults to on. */
  includeOfficial?: boolean;
  /**
   * Fall back to the sandboxed browser when plain HTTP gets nothing.
   * Defaults to on. Turned off in tests and anywhere a multi-second cost is
   * worse than an empty result.
   */
  allowBrowser?: boolean;
  /**
   * Also read the news feeds (`./news`). Off by default, and decided from the
   * QUESTION rather than from this query — a planner's keywords rarely carry
   * the word "latest" even when the person asking did.
   */
  includeNews?: boolean;
}

/**
 * Search the web. GOV.UK is queried alongside the general engines rather than
 * instead of them, because it is authoritative but narrow.
 */
/** Run one source, recording what happened rather than letting it vanish. */
async function tryLane(
  name: string,
  run: () => Promise<SearchResult[]>,
  attempts: SearchOutcome['attempts']
): Promise<SearchResult[]> {
  try {
    const found = await run();
    attempts.push({ engine: name, outcome: found.length ? `${found.length} results` : 'no results' });
    return found;
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    attempts.push({
      engine: name,
      outcome: status === 403 || status === 429 ? 'blocked' : 'error',
      message: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

/**
 * Search the web.
 *
 * Sources are grouped by whether they WANT to be queried programmatically, and
 * that grouping is the whole design. Publishers with real APIs — GOV.UK,
 * legislation.gov.uk, Wikipedia, a self-hosted SearXNG — are queried first and
 * always answer. General engines are attempted afterwards as a supplement, and
 * are expected to refuse: as of this writing DuckDuckGo and Mojeek both serve a
 * CAPTCHA to anything that is not a person, over HTTP and in a headless browser
 * alike.
 *
 * That refusal is reported honestly and never worked around. An earlier version
 * recorded a challenge page as "no results", which reads as "the web has nothing
 * on this" when what actually happened is that nobody was allowed to look — a
 * materially different fact for whoever relies on the answer.
 */
export async function search(query: string, options: SearchOptions = {}): Promise<SearchOutcome> {
  const text = String(query || '').trim();
  if (text.length < 2) {
    return { query: text, engine: null, results: [], attempts: [], note: 'That is too short to search for.' };
  }

  const attempts: SearchOutcome['attempts'] = [];
  const used: string[] = [];

  /* ---- primary sources: publishers with an interface meant for this ---- */
  const primary: SearchResult[] = [];

  if (options.includeOfficial !== false) {
    const [govResults, legResults, wikiResults, searxResults, newsResults] = await Promise.all([
      tryLane('gov.uk', () => govUk(text), attempts),
      tryLane('legislation.gov.uk', () => legislation(text), attempts),
      tryLane('wikipedia', () => wikipedia(text), attempts),
      process.env.SEARXNG_URL?.trim()
        ? tryLane('searxng', () => searxng(text), attempts)
        : Promise.resolve([] as SearchResult[]),
      /* Named publishers with their own timestamps. Only for a question that
         asked about recent events — a rule has not changed because a newspaper
         wrote about it, and mixing a fortnight of headlines into a question
         about a published threshold buries the page that states it. */
      options.includeNews ? tryLane('news', () => newsLane(text), attempts) : Promise.resolve([] as SearchResult[])
    ]);

    for (const [name, results] of [
      ['gov.uk', govResults],
      ['legislation.gov.uk', legResults],
      ['news', newsResults],
      ['searxng', searxResults],
      ['wikipedia', wikiResults]
    ] as const) {
      if (results.length) {
        primary.push(...results);
        used.push(name);
      }
    }
  }

  /* ---- general engines: best effort, expected to refuse ---- */
  let general: SearchResult[] = [];

  for (const engine of ENGINES) {
    if (engineIsCooling(engine.name)) {
      attempts.push({ engine: engine.name, outcome: 'skipped (recently refused)' });
      continue;
    }

    try {
      const res = await fetchText(engine.url(text), { cacheMs: SEARCH_CACHE_MS, accept: 'text/html' });

      if (looksChallenged(res.data)) {
        engineCooldown.set(engine.name, Date.now() + ENGINE_COOLDOWN_MS);
        attempts.push({ engine: engine.name, outcome: 'blocked (challenge page)' });
        continue;
      }

      const found = engine.parse(res.data);
      if (found.length) {
        general = found;
        used.push(engine.name);
        attempts.push({ engine: engine.name, outcome: `${found.length} results` });
        break;
      }
      attempts.push({ engine: engine.name, outcome: 'no results' });
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      attempts.push({
        engine: engine.name,
        outcome: status === 403 || status === 429 ? 'blocked' : 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /* ---- the sandboxed browser, only where it can still help ----
   *
   * Skipped entirely when the primary sources already answered, because
   * launching Chromium costs seconds and a research pass runs several queries.
   * Also skipped for an engine already known to be challenging us — a challenge
   * served over HTTP is served to a headless browser too, and retrying it is
   * both useless and the beginning of an evasion arms race this does not enter.
   *
   * And skipped where there is no browser to drive. `playwright-core` runs an
   * installed Chromium rather than shipping one, so whether this lane exists is
   * a fact about the host — see `browser.ts`. It is reported as a lane that was
   * unavailable, which is a different statement from "the web had nothing".
   */
  const { browserEnabled } = await import('./browser');

  const browserWorthTrying =
    options.allowBrowser !== false && !general.length && primary.length < 3 &&
    ENGINES.some((engine) => !engineIsCooling(engine.name));

  if (browserWorthTrying && !browserEnabled()) {
    attempts.push({ engine: 'browser', outcome: 'unavailable on this host' });
  }

  if (browserWorthTrying && browserEnabled()) {
    const { BrowseSession } = await import('./browser');
    const session = new BrowseSession();
    try {
      for (const engine of ENGINES) {
        if (engineIsCooling(engine.name)) continue;
        try {
          const visited = await session.open(engine.url(text));
          if (visited.blocked || looksChallenged(visited.html)) {
            engineCooldown.set(engine.name, Date.now() + ENGINE_COOLDOWN_MS);
            attempts.push({ engine: `${engine.name} (browser)`, outcome: 'blocked (challenge page)' });
            continue;
          }
          const found = engine.parse(visited.html);
          if (found.length) {
            general = found;
            used.push(`${engine.name} (browser)`);
            attempts.push({ engine: `${engine.name} (browser)`, outcome: `${found.length} results` });
            break;
          }
          attempts.push({ engine: `${engine.name} (browser)`, outcome: 'no results' });
        } catch (error) {
          attempts.push({
            engine: `${engine.name} (browser)`,
            outcome: 'error',
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } finally {
      await session.close();
    }
  }

  const combined = diversify([...primary, ...general]).slice(0, options.limit ?? MAX_RESULTS);

  if (!combined.length) {
    return {
      query: text,
      engine: null,
      results: [],
      attempts,
      /* Said plainly, because "no results" and "every engine refused us" are
         different facts and only one of them is about the question. */
      note: 'No source answered. ' + attempts.map((a) => `${a.engine}: ${a.outcome}`).join('; ')
    };
  }

  const blocked = attempts.filter((a) => a.outcome.startsWith('blocked')).map((a) => a.engine);

  return {
    query: text,
    engine: used.join(' + ') || null,
    results: combined,
    attempts,
    note: blocked.length
      ? `General web search was refused by ${blocked.join(', ')}; answered from sources that publish an interface for this.`
      : undefined
  };
}
