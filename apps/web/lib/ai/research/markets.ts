/* Figures about a company, from the filings and the market rather than from a
 * page that mentions it.
 *
 * THE FAILURE THIS EXISTS FOR. Asked to analyse a listed company as an
 * investment, retrieval had nowhere to go: the lanes it had were GOV.UK,
 * legislation.gov.uk and Wikipedia. It came back with "2025 in the United
 * States" and "Julia (programming language)", and then declined to answer. No
 * amount of re-ranking fixes that, because the pages that hold the answer were
 * never candidates — revenue, cash flow and debt live in a filing, and a price
 * lives on an exchange.
 *
 * BOTH SOURCES ARE FREE AND NEED NO ACCOUNT. The SEC's XBRL API serves what a
 * company has actually filed, and asks only that callers identify themselves —
 * which is done, not worked around. Yahoo's chart endpoint serves quotes without
 * a key; its `v7/finance/quote` does not, requiring a crumb and a cookie, so it
 * is not used and nothing here pretends otherwise.
 *
 * WHAT IS NOT AVAILABLE IS SAID OUT LOUD. Insider dealing and the institutional
 * ownership breakdown have no free keyless source. The block this produces names
 * them as unavailable, so an answer reports a gap instead of estimating one —
 * the same discipline the immigration side applies to an unstated figure.
 *
 * EVERY NUMBER CARRIES ITS DATE. A filed figure carries the fiscal year, the
 * form it came from and when it was filed; a price carries the exchange's own
 * timestamp. At 8am in London the newest real price of a US share is Friday's
 * close, and printing it without the time makes it look like this morning's.
 */

import { fetchJson } from './http';

/* The SEC asks for an identifying string with a contact address on automated
   requests, and refuses a generic browser one. This is that. */
const SEC_AGENT = `SYRIX Forma research assistant (${process.env.SEC_CONTACT_EMAIL || 'contact not configured'})`;

const DAY_MS = 86_400_000;
const TICKER_CACHE_MS = 7 * DAY_MS;
/* Filings do not change between refreshes; prices do. */
const FILING_CACHE_MS = 6 * 60 * 60 * 1000;
const QUOTE_CACHE_MS = 60 * 1000;

export interface MarketSource {
  label: string;
  url: string;
  text: string;
  authority: 'official' | 'reputable';
  /** When the publisher last changed what this says — a filing date, or a quote's own timestamp. */
  publishedAt?: string;
  retrievedAt: number;
}

/* ---------- is this that kind of question ---------- */

const FINANCIAL_INTENT =
  /\b(share price|stock|shares|ticker|market cap(?:italisation|italization)?|valuation|p\/e|pe ratio|revenue|turnover|earnings|eps|free cash ?flow|cash ?flow|balance sheet|dividend|invest(?:ment|ing|or)?|bull case|bear case|financials?|quarterly results|annual report|10-?[kq]\b|profit|margins?|debt|guidance|outlook)\b/i;

/* Words that start a sentence and mean nothing about a company. */
const NOT_A_COMPANY = new Set([
  'analyse', 'analyze', 'the', 'a', 'an', 'i', 'we', 'is', 'are', 'do', 'does', 'can', 'what',
  'which', 'who', 'when', 'where', 'why', 'how', 'and', 'or', 'if', 'in', 'on', 'at', 'to', 'for',
  'of', 'as', 'it', 'this', 'that', 'give', 'tell', 'explain', 'cover', 'compare', 'uk', 'us',
  'usa', 'ai', 'eps', 'ipo', 'esg'
]);

/**
 * The company a question is about, as the asker wrote it.
 *
 * A run of capitalised words, because that is what a company name looks like in
 * a sentence and a ticker is a capitalised word too. Yahoo's own search does the
 * hard part of turning "Nvidia", "NVDA" or "nvidia corp" into a symbol, so this
 * only has to find the candidate rather than recognise it.
 */
export function companyIn(question: string): string | null {
  for (const sentence of question.split(/(?<=[.!?])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/);
    let run: string[] = [];

    for (let index = 0; index < words.length; index++) {
      const word = words[index]!.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}&.]+$/gu, '');
      const capitalised = /^\p{Lu}/u.test(word) && word.length >= 2;
      const usable = capitalised && index > 0 && !NOT_A_COMPANY.has(word.toLowerCase());

      if (usable) {
        run.push(word);
        continue;
      }

      if (run.length) return run.join(' ');
      run = [];
    }

    if (run.length) return run.join(' ');
  }

  return null;
}

/** Whether a question is about a company's figures rather than about a rule. */
export function looksLikeCompanyQuestion(question: string): boolean {
  return FINANCIAL_INTENT.test(question) && companyIn(question) !== null;
}

/* ---------- numbers ---------- */

/* `Number(null)` is 0, and 0 is finite.
 *
 * This is the single most productive source of confidently wrong figures in
 * anything that reads a financial feed: an absent value becomes zero, zero
 * passes every "is it a number" check, and a missing day high prints as 0.00
 * next to real ones. Null is tested for before any coercion happens, and
 * nothing downstream sees a number that was never published. */
function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const asNumber = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

/* LSE quotes come back as `GBp` — pence. HSBA.L at 1532.1 is £15.32, and
   printing "£1,532.10" is wrong by a hundred times while looking entirely
   ordinary. Pence are shown as pence. */
function money(value: number | null, currency: string): string {
  if (value === null) return 'not stated';

  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
  const magnitude = Math.abs(value);

  const digits =
    magnitude >= 1000 ? 0 : magnitude >= 1 ? 2 : 4;
  const formatted = magnitude.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });

  const body = currency === 'GBp' ? `${formatted}p` : symbol ? `${symbol}${formatted}` : `${formatted} ${currency}`;
  /* Built as -£2.40 rather than £-2.40. */
  return value < 0 ? `-${body}` : body;
}

/** Large figures read better in their own scale, and a filing's units never change. */
function scaled(value: number | null, currency: string): string {
  if (value === null) return 'not stated';
  const magnitude = Math.abs(value);

  if (magnitude >= 1e9) return `${money(value / 1e9, currency)} billion`;
  if (magnitude >= 1e6) return `${money(value / 1e6, currency)} million`;
  return money(value, currency);
}

function percentChange(now: number | null, before: number | null): string {
  if (now === null || before === null || before === 0) return 'not calculable';
  const change = ((now - before) / Math.abs(before)) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
}

/* ---------- the market ---------- */

interface YahooQuoteMatch {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchange?: string;
}

/** Resolve a name or ticker to a symbol. Equities only — half the matches for a plain word are funds. */
async function resolveSymbol(name: string): Promise<YahooQuoteMatch | null> {
  const { data } = await fetchJson<{ quotes?: YahooQuoteMatch[] }>(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=8&newsCount=0`,
    { cacheMs: DAY_MS }
  );

  const quotes = data.quotes ?? [];
  return quotes.find((quote) => quote.quoteType === 'EQUITY' && quote.symbol) ?? null;
}

interface ChartMeta {
  currency?: string;
  symbol?: string;
  exchangeName?: string;
  instrumentType?: string;
  longName?: string;
  shortName?: string;
  regularMarketPrice?: number | null;
  previousClose?: number | null;
  chartPreviousClose?: number | null;
  regularMarketTime?: number | null;
  fiftyTwoWeekHigh?: number | null;
  fiftyTwoWeekLow?: number | null;
  regularMarketDayHigh?: number | null;
  regularMarketDayLow?: number | null;
  regularMarketVolume?: number | null;
}

/* THE PREVIOUS CLOSE CANNOT BE TAKEN FROM `chartPreviousClose` ON A LONG RANGE.
 *
 * That field is the close immediately BEFORE the requested window, so asking
 * for a year of daily candles and reading it gives the price a year ago. With
 * `previousClose` absent at a daily interval — a known gap — the fallback chain
 * silently produced a day's change of +23.8% for Nvidia and +44.9% for Apple.
 * Both figures were arithmetically correct and described a year, printed under
 * a label that said a day.
 *
 * A month of candles is requested instead and the previous close is read from
 * the series itself: the last close before the most recent one. Nulls are
 * skipped rather than coerced, because a halted or untraded day arrives as null
 * and `Number(null)` is 0. */
const CHART_RANGE = '1mo';

async function quote(symbol: string): Promise<{ meta: ChartMeta; previousClose: number | null } | null> {
  const { data } = await fetchJson<{
    chart?: {
      result?: {
        meta?: ChartMeta;
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }[];
    };
  }>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${CHART_RANGE}&interval=1d`,
    { cacheMs: QUOTE_CACHE_MS }
  );

  const result = data.chart?.result?.[0];
  if (!result?.meta) return null;

  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter(
    (close): close is number => finiteOrNull(close) !== null
  );

  /* The last close is today's (or the most recent session's); the one before it
     is what "previous close" means. `meta.previousClose` is preferred when the
     endpoint supplies it, since it is the exchange's own figure. */
  const fromSeries = closes.length >= 2 ? closes[closes.length - 2]! : null;

  return { meta: result.meta, previousClose: finiteOrNull(result.meta.previousClose) ?? fromSeries };
}

/* ---------- the filings ---------- */

interface TickerRow {
  cik_str?: number;
  ticker?: string;
  title?: string;
}

/** Ticker to SEC central index key. One file, cached for a week — it changes rarely. */
async function cikFor(symbol: string): Promise<{ cik: string; title: string } | null> {
  const { data } = await fetchJson<Record<string, TickerRow>>('https://www.sec.gov/files/company_tickers.json', {
    cacheMs: TICKER_CACHE_MS,
    userAgent: SEC_AGENT
  });

  /* Yahoo suffixes a symbol with its exchange outside the US — "SHEL.L". The
     SEC file holds the bare symbol, so the suffix is dropped before matching. */
  const bare = symbol.split('.')[0]!.toUpperCase();

  for (const row of Object.values(data)) {
    if (row?.ticker?.toUpperCase() === bare && row.cik_str !== undefined) {
      return { cik: String(row.cik_str).padStart(10, '0'), title: row.title ?? bare };
    }
  }

  return null;
}

export interface ConceptEntry {
  start?: string;
  end?: string;
  val?: number | null;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
}

interface Annual {
  value: number;
  end: string;
  form: string;
  filed: string;
}

/* A concept is requested under several tag names and ALL OF THEM ARE MERGED.
 *
 * Companies do not all use the same tag, and — the part that actually bit — one
 * company does not use the same tag forever. Taking the first tag that returned
 * anything gave Nvidia's revenue as $26.9bn for the year to January 2022: that
 * tag was real, the figures were real, and the company had stopped filing under
 * it four years earlier. It sat in an answer next to a net income figure from
 * 2026 and looked like a collapse in margins rather than a bug.
 *
 * Merging and then taking the newest period per tag-set is the only version of
 * this that survives a filer changing its taxonomy. A period reported under two
 * tags is deduplicated downstream by its end date. */
async function concept(cik: string, tags: string[]): Promise<ConceptEntry[]> {
  const fetched = await Promise.all(
    tags.map(async (tag) => {
      try {
        const { data } = await fetchJson<{ units?: Record<string, ConceptEntry[]> }>(
          `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`,
          { cacheMs: FILING_CACHE_MS, userAgent: SEC_AGENT }
        );

        const units = data.units ?? {};
        return units.USD ?? Object.values(units)[0] ?? [];
      } catch {
        /* A tag this filer has never used answers 404. That is information, not
           a failure — the other tags still stand. */
        return [] as ConceptEntry[];
      }
    })
  );

  return fetched.flat();
}

/* The annual figures, newest first.
 *
 * A period is a year when its start and end are roughly 365 days apart — a
 * quarter filed on the same tag would otherwise be read as a year and make
 * revenue look like it collapsed. Instant concepts (debt, equity) have no start
 * date at all and are taken as they are. */
export function annuals(entries: ConceptEntry[], limit = 3): Annual[] {
  const yearly = entries.filter((entry) => {
    if (!entry.end || finiteOrNull(entry.val) === null) return false;
    if (!entry.form?.startsWith('10-K') && !entry.form?.startsWith('20-F')) return false;
    if (!entry.start) return true;

    const days = (new Date(entry.end).getTime() - new Date(entry.start).getTime()) / DAY_MS;
    return days > 340 && days < 400;
  });

  const byEnd = new Map<string, Annual>();
  for (const entry of yearly) {
    /* The same year appears in several filings as a comparative. The most
       recently filed statement of it is the restated one. */
    const existing = byEnd.get(entry.end!);
    if (existing && existing.filed >= (entry.filed ?? '')) continue;

    byEnd.set(entry.end!, {
      value: finiteOrNull(entry.val)!,
      end: entry.end!,
      form: entry.form ?? 'unknown form',
      filed: entry.filed ?? 'unknown date'
    });
  }

  return [...byEnd.values()].sort((a, b) => b.end.localeCompare(a.end)).slice(0, limit);
}

/* EVERY YEAR-ON-YEAR CHANGE IS STATED, NOT JUST THE MOST RECENT ONE.
 *
 * The first version gave three years of figures and one change. Asked to cover
 * revenue growth, the model correctly worked the other changes out itself — and
 * the guard that flags figures appearing in no source then flagged its own
 * arithmetic, putting "figures with no source: 114%, 144%, 125%" under an answer
 * whose every number was right. A guard that false-positives is a guard people
 * learn to ignore, and the cheapest fix is to make the derived figure a stated
 * one: the change between two filed numbers is not a new fact. */
function line(label: string, figures: Annual[], currency: string): string {
  if (!figures.length) return `${label}: not found in the filings read here`;

  const parts = figures.map((figure, index) => {
    const stated = `${figure.end.slice(0, 4)} (year to ${figure.end}): ${scaled(figure.value, currency)}`;
    const earlier = figures[index + 1];
    if (!earlier) return stated;
    return `${stated}, ${percentChange(figure.value, earlier.value)} on the year before`;
  });

  return `${label}: ${parts.join('; ')} [${figures[0]!.form}, filed ${figures[0]!.filed}]`;
}

/* ---------- the block the answer is written from ---------- */

/**
 * Market and filing figures for the company a question names.
 *
 * Returns an empty array rather than throwing. This is one lane among several,
 * and a company that does not file with the SEC — most of the world — should
 * cost the turn a missing block, not an error.
 */
export async function marketEvidence(question: string): Promise<MarketSource[]> {
  const name = companyIn(question);
  if (!name) return [];

  const match = await resolveSymbol(name).catch(() => null);
  if (!match?.symbol) return [];

  const symbol = match.symbol;
  const company = match.longname ?? match.shortname ?? name;
  const sources: MarketSource[] = [];
  const retrievedAt = Date.now();

  /* ---- the market ---- */
  const quoted = await quote(symbol).catch(() => null);
  let currency = quoted?.meta.currency ?? 'USD';

  if (quoted) {
    const meta = quoted.meta;
    const price = finiteOrNull(meta.regularMarketPrice);
    const before = quoted.previousClose;
    const asOf = finiteOrNull(meta.regularMarketTime);

    sources.push({
      label: `${company} (${symbol}) — market data, Yahoo Finance`,
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
      authority: 'reputable',
      retrievedAt,
      publishedAt: asOf ? new Date(asOf * 1000).toISOString() : undefined,
      text: [
        `${company} (${symbol}) — ${meta.exchangeName ?? 'exchange not stated'}, quoted in ${currency}.`,
        /* The "as of" time is the whole honesty story. At 8am in London the
           newest real price of a US share is Friday's close. */
        asOf
          ? `AS AT ${new Date(asOf * 1000).toISOString()} — this is the exchange's own timestamp for the last trade, not the time you are reading it.`
          : 'The exchange gave no timestamp for this price, so how recent it is cannot be established.',
        `Last price: ${money(price, currency)}`,
        `Previous session's close: ${money(before, currency)}`,
        `Change on the session: ${percentChange(price, before)}`,
        `52-week range: ${money(finiteOrNull(meta.fiftyTwoWeekLow), currency)} to ${money(finiteOrNull(meta.fiftyTwoWeekHigh), currency)}`,
        `Volume on the day: ${finiteOrNull(meta.regularMarketVolume)?.toLocaleString('en-GB') ?? 'not stated'}`,
        '',
        'NOT AVAILABLE FROM THIS SOURCE, and not to be estimated: price/earnings and other valuation multiples, analyst estimates and price targets, institutional ownership, insider dealing. None of these has a free source here. Say they were not available rather than supplying a figure.'
      ].join('\n')
    });
  }

  /* ---- the filings ---- */
  const registrant = await cikFor(symbol).catch(() => null);

  if (registrant) {
    const [revenue, netIncome, operatingCash, capex, liabilities, longTermDebt, equity] = await Promise.all([
      concept(registrant.cik, [
        'RevenueFromContractWithCustomerExcludingAssessedTax',
        'Revenues',
        'RevenueFromContractWithCustomerIncludingAssessedTax',
        'SalesRevenueNet'
      ]),
      concept(registrant.cik, ['NetIncomeLoss']),
      concept(registrant.cik, [
        'NetCashProvidedByUsedInOperatingActivities',
        'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'
      ]),
      concept(registrant.cik, [
        'PaymentsToAcquirePropertyPlantAndEquipment',
        'PaymentsToAcquireProductiveAssets',
        'PaymentsToAcquireOtherPropertyPlantAndEquipment'
      ]),
      concept(registrant.cik, ['Liabilities']),
      concept(registrant.cik, ['LongTermDebtNoncurrent', 'LongTermDebt']),
      concept(registrant.cik, ['StockholdersEquity'])
    ]);

    const revenueYears = annuals(revenue);
    const cashYears = annuals(operatingCash);
    const capexYears = annuals(capex);

    /* Free cash flow is not a filed concept — it is operating cash flow less
       capital expenditure, and is labelled here as the derived figure it is so
       an answer does not present it as something the company reported. */
    const freeCashFlow = cashYears
      .map((year) => {
        const spend = capexYears.find((entry) => entry.end === year.end);
        if (!spend) return null;
        return { ...year, value: year.value - Math.abs(spend.value) };
      })
      .filter((entry): entry is Annual => entry !== null);

    /* Filings are in the currency of the filing, which for a US registrant is
       dollars whatever the quote said — a London listing of a US filer would
       otherwise print dollars as pence. */
    currency = 'USD';

    sources.push({
      label: `${registrant.title} — figures as filed, SEC EDGAR`,
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${registrant.cik}&type=10-K`,
      authority: 'official',
      retrievedAt,
      publishedAt: revenueYears[0]?.filed,
      text: [
        `${registrant.title} (CIK ${registrant.cik}) — figures taken from the company's own filings through the SEC's XBRL data, in USD.`,
        'Each line gives the most recent fiscal years, the form the figure came from, and when that form was filed.',
        '',
        line('Revenue', revenueYears, currency),
        line('Net income', annuals(netIncome), currency),
        line('Cash from operations', cashYears, currency),
        line('Capital expenditure', capexYears, currency),
        line('Free cash flow (cash from operations less capital expenditure — derived here, not a filed figure)', freeCashFlow, currency),
        line('Total liabilities', annuals(liabilities), currency),
        line('Long-term debt', annuals(longTermDebt), currency),
        line('Shareholders’ equity', annuals(equity), currency),
        '',
        'A line reading "not found in the filings read here" means that tag was not among the ones requested for this filer — it does not mean the company reported nothing. Say it was not retrieved rather than supplying a number.'
      ].join('\n')
    });
  }

  return sources;
}
