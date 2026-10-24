/* Turning a web address into readable prose the model can be given.
 *
 * A narrowed region is kept ONLY if it holds most of the page's prose. An
 * earlier version of this idea matched a content div whose non-greedy close
 * landed a few sentences in, returned 585 characters of a 6,000-character page,
 * and the model — given almost nothing to read — invented the rest. Falling back
 * to the whole body is far better than confidently returning a fragment.
 *
 * Everything returned from here is UNTRUSTED. It is wrapped for the model by
 * `lib/ai/safety`, never concatenated into an instruction, and the agents that
 * read it hold no tool that can act.
 */

import { fetchJson, fetchText } from './http';
import { authorityOf, domainOf, stripTags, type Authority } from './search';

export interface Section {
  title: string;
  text: string;
}

export interface Page {
  url: string;
  title: string;
  domain: string;
  /** The whole readable page. Use `sections` plus `lib/ai/research/relevance` to choose what the model reads. */
  text: string;
  /** The page split at its own headings, so a long guide can be read by the part that answers the question. */
  sections: Section[];
  truncated: boolean;
  length: number;
  authority: Authority;
  /** When this pipeline retrieved it. */
  retrievedAt: number;
  /** When the publisher last changed it, where the source says so. */
  publishedAt?: string;
  cached: boolean;
  /** Which extractor ran. Surfaced so a thin result can be recognised as thin. */
  via: 'gov.uk-content-api' | 'html';
}

/* Deliberately generous, and deliberately not the budget the model sees.
 *
 * An earlier version capped the page at 12,000 characters and handed the model
 * the first 12,000. On the Skilled Worker guide — 57,373 characters across
 * fifteen parts — that kept the overview and cut every word about salary, which
 * is the part most questions are actually about. The model then had an
 * authoritative page in front of it and no way to answer from it.
 *
 * So the whole page is kept here, and `relevance.ts` chooses which sections are
 * worth the model's context for a given question. Truncating by position throws
 * away the answer; truncating by relevance throws away the preamble. */
const DEFAULT_LIMIT = 200_000;
const PAGE_CACHE_MS = 30 * 60 * 1000;

/* ---------- GOV.UK content API ---------- */

interface GovUkContent {
  title?: string;
  description?: string;
  public_updated_at?: string;
  updated_at?: string;
  details?: {
    body?: string;
    parts?: { title?: string; body?: string; slug?: string }[];
  };
}

/* GOV.UK serves its own pages as structured JSON at /api/content<path>.
 *
 * Worth a dedicated path rather than scraping the rendered page for two
 * reasons. The content arrives already split into titled parts, so a guide
 * covering fifteen topics can be read as fifteen labelled sections instead of
 * one undifferentiated wall — and the salary section stays identifiable as the
 * salary section. And `public_updated_at` is the publisher's own timestamp,
 * which is the difference between "the threshold is X" and "the threshold was X
 * when the Home Office last revised this page". For immigration answers the
 * second one is the only honest form. */
async function readGovUk(url: string, limit: number): Promise<Page | null> {
  const parsed = new URL(url);
  if (parsed.hostname !== 'www.gov.uk' && parsed.hostname !== 'gov.uk') return null;

  const path = parsed.pathname.replace(/\/$/, '');
  if (!path || path === '/api') return null;

  try {
    const { data, at, cached } = await fetchJson<GovUkContent>('https://www.gov.uk/api/content' + path, {
      cacheMs: PAGE_CACHE_MS
    });

    const sections: Section[] = [];
    if (data.description) sections.push({ title: 'Overview', text: data.description });

    /* `parts` is the whole reason this path exists: GOV.UK has already split its
       own guide into titled chapters, which is a better sectioning than any
       heuristic could recover from the rendered page. */
    if (data.details?.parts?.length) {
      for (const part of data.details.parts) {
        const body = stripTags(part.body ?? '');
        if (!body) continue;
        sections.push({ title: part.title?.trim() || 'Untitled section', text: body });
      }
    } else if (data.details?.body) {
      sections.push(...splitHeadings(stripTags(data.details.body), data.title?.trim() || 'Body'));
    }

    const text = sections.map((s) => `## ${s.title}\n${s.text}`).join('\n\n').trim();
    /* An empty or near-empty extraction means this content type does not fit
       the shape above. Returning null hands it back to the HTML reader rather
       than reporting a blank page as a successful read. */
    if (text.length < 200) return null;

    return {
      url,
      title: data.title?.trim() || url,
      domain: domainOf(url) ?? parsed.hostname,
      text: text.slice(0, limit),
      sections,
      truncated: text.length > limit,
      length: text.length,
      authority: authorityOf(url),
      retrievedAt: at,
      publishedAt: data.public_updated_at ?? data.updated_at,
      cached,
      via: 'gov.uk-content-api'
    };
  } catch {
    /* The content API not answering is not a reason to give up on the page —
       fall through to reading the rendered HTML. */
    return null;
  }
}

/* ---------- general HTML ---------- */

/* A publisher's own date, where the page states one in a machine-readable form.
   Tried in descending order of how deliberate each signal is: an explicit
   article:modified_time is a publishing decision, a <time datetime> is usually
   one, and a JSON-LD dateModified is often generated. */
function publishedDateFrom(html: string): string | undefined {
  const patterns = [
    /<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']last-?modified["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /"dateModified"\s*:\s*"([^"]+)"/i,
    /"datePublished"\s*:\s*"([^"]+)"/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const parsed = new Date(match[1]);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return undefined;
}

/* Split already-stripped prose at the heading markers planted below.
 *
 * Sections are what make a long page usable: the reader picks the two that
 * answer the question instead of the first N characters, which on a guide with
 * the answer in chapter seven is the difference between an answer and a
 * confident blank. */
function splitHeadings(html: string, fallbackTitle: string): Section[] {
  const sections: Section[] = [];

  /* Split on the heading tags themselves, while the markup is still there.
     Doing it after tag-stripping needs a sentinel planted in the text, and any
     sentinel is either a control character that some pipeline stage eats or a
     printable string that eventually occurs in real prose and splits a page
     mid-sentence. The markup already marks the boundaries — use it. */
  const pieces = html.split(/<h[1-6][^>]*>/i);

  const preamble = stripTags(pieces[0] ?? '');
  if (preamble.length > 80) sections.push({ title: fallbackTitle, text: preamble });

  for (const piece of pieces.slice(1)) {
    const close = piece.search(/<\/h[1-6]>/i);
    if (close === -1) continue;
    const title = stripTags(piece.slice(0, close));
    const body = stripTags(piece.slice(close));
    if (!body) continue;
    sections.push({ title: title || fallbackTitle, text: body });
  }

  return sections.length ? sections : [{ title: fallbackTitle, text: stripTags(html) }];
}

async function readHtml(url: string, limit: number): Promise<Page> {
  const res = await fetchText(url, {
    cacheMs: PAGE_CACHE_MS,
    accept: 'text/html,application/xhtml+xml',
    timeoutMs: 20_000
  });

  const raw = res.data;
  const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const publishedAt = publishedDateFrom(raw);

  /* Everything that is not prose. Cookie banners and consent dialogs are
     stripped too — left in, they are frequently the longest run of text on a
     page and a naive extractor returns the privacy policy as the article. */
  const cleaned = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<div[^>]+(?:id|class)=["'][^"']*(?:cookie|consent|gdpr)[^"']*["'][\s\S]*?<\/div>/gi, ' ');

  const whole = stripTags(cleaned);

  /* Keep the narrowed region only if it holds most of the page's prose.
     An earlier version of this idea matched a content div whose non-greedy
     close landed a few sentences in, returned 585 characters of a
     6,000-character page, and the model — given almost nothing to read —
     invented the rest. Falling back to the whole body beats confidently
     returning a fragment. */
  let bestHtml = cleaned;
  const article = cleaned.match(/<article[\s\S]*?<\/article>/i) ?? cleaned.match(/<main[\s\S]*?<\/main>/i);
  if (article && stripTags(article[0]).length > whole.length * 0.4) bestHtml = article[0];

  const pageTitle = title ? stripTags(title) : (domainOf(url) ?? url);
  const best = stripTags(bestHtml);

  return {
    url,
    title: pageTitle,
    domain: domainOf(url) ?? url,
    text: best.slice(0, limit),
    sections: splitHeadings(bestHtml, pageTitle),
    truncated: best.length > limit,
    length: best.length,
    authority: authorityOf(url),
    retrievedAt: res.at,
    publishedAt,
    cached: res.cached,
    via: 'html'
  };
}

/** Read one page, preferring a publisher's structured API where one exists. */
export async function readPage(url: string, options: { limit?: number } = {}): Promise<Page> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const structured = await readGovUk(url, limit);
  if (structured) return structured;
  return readHtml(url, limit);
}

/** Read several pages, keeping whatever succeeds. One dead link is not a dead research pass. */
export async function readPages(urls: string[], options: { limit?: number } = {}): Promise<{
  pages: Page[];
  failures: { url: string; reason: string }[];
}> {
  const settled = await Promise.allSettled(urls.map((url) => readPage(url, options)));

  const pages: Page[] = [];
  const failures: { url: string; reason: string }[] = [];

  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') pages.push(outcome.value);
    else {
      failures.push({
        url: urls[index]!,
        reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
      });
    }
  });

  return { pages, failures };
}
