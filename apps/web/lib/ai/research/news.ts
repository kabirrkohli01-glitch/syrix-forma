/* What happened recently, from publishers rather than from an aggregator.
 *
 * THE FAILURE THIS EXISTS FOR. Asked for the three biggest AI industry stories
 * of the last 24 hours, the assistant had no way to find news at all: retrieval
 * knew about GOV.UK, legislation.gov.uk and Wikipedia, and general engines serve
 * a challenge page. What it found was a content farm calling itself a news
 * digest, and it repeated that page's inventions — a chip that does not exist, a
 * product launch that did not happen — as the day's headlines, complete with
 * timestamps. Every layer worked: the page was fetched, ranked, read and cited.
 * Nothing in the pipeline could tell an aggregator from a newsroom.
 *
 * SO THE PUBLISHERS ARE NAMED, AND ONLY NAMED ONES ARE READ. This lane is a
 * fixed list of feeds that established organisations publish for exactly this
 * purpose. No account, no key, no crawling of anything that did not offer a
 * feed. A story that is not in one of these does not appear, which is the right
 * failure: a gap is recoverable, a fabricated headline attributed to a real
 * industry is not.
 *
 * EVERY ITEM CARRIES THE PUBLISHER'S OWN TIMESTAMP. "Recent" is decided against
 * the clock, never against the model's idea of what today is — this codebase has
 * already caught it supplying 2023 as the current year. An item with no usable
 * date is dropped rather than assumed to be new.
 */

import { fetchText } from './http';

/* Deliberately structural rather than imported from `search.ts`: this module is
   used BY that one, and a runtime import in both directions is a cycle waiting
   to bite. The shape is the same. */
export interface NewsItem {
  url: string;
  title: string;
  snippet: string;
  /** The feed it came from, shown to the reader as the publisher. */
  engine: string;
  authority: 'official' | 'legal' | 'reputable' | 'unverified';
  /** ISO 8601. Never absent — an undated item is dropped upstream of this. */
  publishedAt: string;
}

interface Feed {
  name: string;
  url: string;
  authority: NewsItem['authority'];
  /** Which subjects this feed is worth fetching for. `general` is always eligible. */
  topics: ('general' | 'tech' | 'business' | 'uk' | 'policy' | 'research')[];
}

/* Chosen for having a public feed and an editorial process, not for agreeing
   with each other. Authority follows the same scale the rest of retrieval uses:
   `official` is the body that makes or administers the thing, `reputable` is an
   established organisation reporting on it. No feed here is `unverified` — that
   is the whole point of the list. */
const FEEDS: Feed[] = [
  { name: 'GOV.UK', url: 'https://www.gov.uk/search/news-and-communications.atom', authority: 'official', topics: ['uk', 'policy'] },
  {
    name: 'Home Office',
    url: 'https://www.gov.uk/government/organisations/home-office.atom',
    authority: 'official',
    topics: ['policy']
  },
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', authority: 'reputable', topics: ['general'] },
  { name: 'BBC News (UK)', url: 'https://feeds.bbci.co.uk/news/uk/rss.xml', authority: 'reputable', topics: ['uk'] },
  {
    name: 'BBC News (Technology)',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    authority: 'reputable',
    topics: ['tech']
  },
  {
    name: 'BBC News (Business)',
    url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    authority: 'reputable',
    topics: ['business']
  },
  { name: 'The Guardian', url: 'https://www.theguardian.com/uk/rss', authority: 'reputable', topics: ['general', 'uk'] },
  {
    name: 'The Guardian (Technology)',
    url: 'https://www.theguardian.com/uk/technology/rss',
    authority: 'reputable',
    topics: ['tech']
  },
  {
    name: 'The Guardian (Business)',
    url: 'https://www.theguardian.com/uk/business/rss',
    authority: 'reputable',
    topics: ['business']
  },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', authority: 'reputable', topics: ['tech'] },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', authority: 'reputable', topics: ['tech'] },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', authority: 'reputable', topics: ['tech', 'business'] },
  {
    name: 'MIT Technology Review',
    url: 'https://www.technologyreview.com/feed/',
    authority: 'reputable',
    topics: ['tech', 'research']
  },
  /* Preprints, and treated as such: `reputable` because arXiv is where this
     work is announced, not because a preprint has been reviewed. An answer
     built on one should say so, and the authority label is what tells it to. */
  {
    name: 'arXiv (AI)',
    url: 'http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=25',
    authority: 'reputable',
    topics: ['research']
  }
];

const MAX_FEEDS = 6;
const MAX_ITEMS = 12;
/* Feeds change often enough that a long cache would defeat the point, and often
   enough that no cache at all would refetch the same twelve feeds for each of a
   pass's queries. */
const FEED_CACHE_MS = 5 * 60 * 1000;
/* How far back an item can be and still count as news. Wider than most
   questions ask for on purpose: the answer states each item's real date, so a
   fortnight of context is useful, and filtering to 24 hours here would leave a
   Monday question about the weekend with nothing. */
const MAX_AGE_DAYS = 21;

/* ---------- when this lane runs ---------- */

const RECENCY =
  /\b(news|headlines?|latest|recent(?:ly)?|today|yesterday|this (?:morning|week|month)|past (?:day|week|month|24 ?hours)|last (?:24 ?hours|day|week|night|month)|breaking|just (?:announced|happened|released)|so far this (?:week|month|year)|right now|currently|announced)\b/i;

/** Whether a question is asking what has happened lately rather than what a rule says. */
export function looksLikeNewsQuestion(text: string): boolean {
  return RECENCY.test(text);
}

const TOPIC_PATTERNS: { topic: Feed['topics'][number]; pattern: RegExp }[] = [
  {
    topic: 'tech',
    pattern:
      /\b(ai|a\.i\.|artificial intelligence|machine learning|llm|model|chip|gpu|semiconductor|software|tech|technology|startup|openai|anthropic|google|microsoft|apple|nvidia|meta|data ?centre|data ?center|robot|quantum)\b/i
  },
  {
    topic: 'business',
    pattern:
      /\b(market|markets|stock|shares?|economy|economic|inflation|interest rates?|earnings|revenue|profit|merger|acquisition|ipo|funding|investment|investor|business|company|companies|industry)\b/i
  },
  {
    topic: 'policy',
    pattern:
      /\b(immigration|visa|home office|asylum|border|deportation|settlement|nationality|policy|regulation|legislation|government|parliament|minister|consultation)\b/i
  },
  { topic: 'uk', pattern: /\b(uk|britain|british|england|scotland|wales|northern ireland|westminster)\b/i },
  { topic: 'research', pattern: /\b(research|paper|papers|preprint|study|studies|benchmark|arxiv|published)\b/i }
];

function feedsFor(query: string): Feed[] {
  const wanted = new Set<Feed['topics'][number]>(['general']);
  for (const { topic, pattern } of TOPIC_PATTERNS) {
    if (pattern.test(query)) wanted.add(topic);
  }

  const eligible = FEEDS.filter((feed) => feed.topics.some((topic) => wanted.has(topic)));

  /* A feed that matched a SPECIFIC topic survives the cap ahead of one that
     only qualified as general interest. Slicing in list order instead dropped
     TechCrunch and MIT Technology Review from a question about AI in favour of
     two front pages, which is the wrong six. */
  const specific = eligible.filter((feed) =>
    feed.topics.some((topic) => topic !== 'general' && wanted.has(topic))
  );
  const rest = eligible.filter((feed) => !specific.includes(feed));

  return [...specific, ...rest].slice(0, MAX_FEEDS);
}

/* ---------- parsing ---------- */

function decodeEntities(text: string): string {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tagValue(block: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return match ? decodeEntities(match[1]!).trim() : undefined;
}

/* Atom puts the address in an attribute and RSS puts it in the element body,
   and plenty of feeds carry both. Atom's `rel="alternate"` is the article; a
   bare `<link>` with no rel is the same thing. `rel="self"` is the feed. */
function itemLink(block: string): string | undefined {
  const inline = tagValue(block, 'link');
  if (inline && /^https?:\/\//i.test(inline)) return inline;

  const hrefs = [...block.matchAll(/<link\b([^>]*)\/?>/gi)];
  for (const [, attributes] of hrefs) {
    if (/rel\s*=\s*["']self["']/i.test(attributes!)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(attributes!)?.[1];
    if (href && /^https?:\/\//i.test(href)) return decodeEntities(href);
  }

  return undefined;
}

/** RSS `pubDate` is RFC 822, Atom `updated` is ISO 8601. Both parse; neither is trusted blindly. */
function itemDate(block: string): string | undefined {
  for (const tag of ['pubDate', 'published', 'updated', 'dc:date']) {
    const raw = tagValue(block, tag);
    if (!raw) continue;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

export function parseFeed(
  xml: string,
  feed: { name: string; authority: NewsItem['authority'] }
): NewsItem[] {
  const blocks = [
    ...xml.split(/<item[\s>]/i).slice(1),
    ...xml.split(/<entry[\s>]/i).slice(1)
  ];

  const items: NewsItem[] = [];

  for (const block of blocks) {
    const title = tagValue(block, 'title');
    const url = itemLink(block);
    const publishedAt = itemDate(block);

    /* An undated item is dropped rather than assumed to be new. A story with no
       timestamp cannot answer a question about the last 24 hours, and putting
       one in the dossier invites the model to date it itself. */
    if (!title || !url || !publishedAt) continue;

    items.push({
      url,
      title: stripTags(title),
      snippet: stripTags(tagValue(block, 'description') ?? tagValue(block, 'summary') ?? '').slice(0, 400),
      engine: feed.name,
      authority: feed.authority,
      publishedAt
    });
  }

  return items;
}

/* ---------- the lane ---------- */

/* WORDS THAT SAY A QUESTION IS ABOUT THE NEWS, NOT WHAT IT IS ABOUT.
 *
 * Scoring "the biggest AI industry news stories of the last 24 hours" against
 * every headline of the day put a piece about a tourist tax and a Strictly Come
 * Dancing item at the top, because both contain "news" and "industry" and the
 * subject word does not have to appear at all for a majority of terms to match.
 * These are what made the question a news question — the lane has already acted
 * on them — so they carry no signal about which stories answer it. */
const META_TERMS = new Set([
  'news', 'story', 'stories', 'headline', 'headlines', 'latest', 'recent', 'recently', 'today',
  'yesterday', 'week', 'month', 'year', 'day', 'days', 'hour', 'hours', 'biggest', 'top', 'main',
  'major', 'important', 'industry', 'sector', 'update', 'updates', 'current', 'currently', 'past',
  'last', 'breaking', 'happened', 'happening', 'announced', 'announcement', 'announcements',
  'developments', 'about', 'from', 'with', 'that', 'this', 'what', 'which', 'were', 'was', 'are',
  'the', 'and', 'for', 'you', 'give', 'tell', 'three', 'five', 'ten',
  /* Dates are a filter, not a subject. The planner writes "AI industry news
     September 10 2026" and almost no headline contains its own month or year, so
     scoring them as content terms dilutes every real match — a story about the
     right subject scored a third, and a story about nothing that happened to say
     "September" scored the same. Recency is already enforced against the clock
     by the cutoff above; it does not need to be enforced again by word match. */
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'
]);

/** A bare year, which is a date qualifier wherever it appears in a query. */
const YEAR = /^(19|20)\d{2}$/;

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/* Whole words, not substrings. "AI" is two characters and the single most
   important term a question about this field contains, so short terms cannot
   simply be dropped — but `includes('ai')` matches "said", "again" and
   "detail", which is how a headline about aid became a headline about AI. */
function score(query: string, item: NewsItem): number {
  const terms = [
    ...new Set(
      words(query).filter((term) => term.length >= 2 && !META_TERMS.has(term) && !YEAR.test(term))
    )
  ];

  /* "What's the latest?" has no subject at all. Everything in the topical feeds
     is an equally good answer to it, so the sort below orders by date alone. */
  if (!terms.length) return 0.01;

  const title = new Set(words(item.title));
  const body = new Set([...title, ...words(item.snippet)]);

  const hits = terms.filter((term) => body.has(term)).length;
  if (!hits) return 0;

  /* A headline is the publisher's own statement of what the story is about, so
     a term there is worth more than the same term in the standfirst. */
  const titleHits = terms.filter((term) => title.has(term)).length;

  return hits / terms.length + titleHits * 0.25;
}

/**
 * Recent stories matching a query, newest first.
 *
 * Never throws. A feed that is down, slow or malformed is one fewer publisher,
 * not a failed turn — the caller has other lanes.
 */
export async function searchNews(query: string, now = Date.now()): Promise<NewsItem[]> {
  const feeds = feedsFor(query);

  const fetched = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const { data } = await fetchText(feed.url, {
          cacheMs: FEED_CACHE_MS,
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml'
        });
        return parseFeed(data, feed);
      } catch {
        return [] as NewsItem[];
      }
    })
  );

  const cutoff = now - MAX_AGE_DAYS * 86_400_000;

  const recent = fetched
    .flat()
    .filter((item) => new Date(item.publishedAt).getTime() >= cutoff)
    /* Same story syndicated across two feeds is one story. */
    .filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index);

  const scored = recent
    .map((item) => ({ item, relevance: score(query, item) }))
    .filter((entry) => entry.relevance > 0)
    .sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return new Date(b.item.publishedAt).getTime() - new Date(a.item.publishedAt).getTime();
    });

  return scored.slice(0, MAX_ITEMS).map((entry) => entry.item);
}
