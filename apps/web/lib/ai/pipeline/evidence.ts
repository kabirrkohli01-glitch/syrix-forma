/* Gathering the evidence a question is answered from.
 *
 * Split out of `answer.ts` because the council needs the same dossier and must
 * not gather its own. Two retrieval paths would drift, and worse, they would
 * make an answer's citations depend on which mode produced it — the same
 * question would cite different pages for no reason the reader could see.
 *
 * What comes back is deliberately NOT fitted to a prompt budget. A single-pass
 * answer spends its whole budget on one prompt; the council spends it across a
 * roster of specialists that each read a different slice closely. Fitting is
 * the consumer's decision, so the pages arrive whole and each caller trims.
 */

import { readPages, type Page } from '../research/read-page';
import { queryTerms, rankResults, selectReading, selectSources, tokenize } from '../research/relevance';
import { looksLikeCompanyQuestion, marketEvidence, type MarketSource } from '../research/markets';
import { looksLikeNewsQuestion } from '../research/news';
import { search } from '../research/search';

export interface EvidenceSource {
  label: string;
  url: string;
  /** The sections of this page that address the question, within its share. */
  text: string;
  publishedAt?: string;
  authority: string;
  /** Kept so a specialist can re-slice the same page against its own remit. */
  page: Page;
  /** How well the page's own body answers the question. */
  contentScore: number;
}

export interface EvidenceBudget {
  pages: number;
  perPage: number;
  officialOversample: number;
}

export interface GatheredEvidence {
  sources: EvidenceSource[];
  /** Pages that were read but ruled out on content, reported rather than hidden. */
  discarded: number;
}

export function isPrimary(authority: string): boolean {
  return authority === 'official' || authority === 'legal';
}

/**
 * How much of the question the retrieved pages actually talk about.
 *
 * WHY THIS IS NEEDED. Search always returns something. Asked to work out how
 * many extra billable hours a 25% fee-income target needs, the router sent the
 * turn to research — "fee" and "UK" were enough — and the pipeline dutifully
 * searched, read six pages, and attached "Visit the UK as a Standard Visitor"
 * and "Prove your right to work to an employer" as the sources for an
 * arithmetic answer. The maths was right. The citations were nonsense, and
 * nonsense citations are worse than none: they are what a reader checks the
 * answer against.
 *
 * Nothing upstream could catch that. The searches ran, the pages were real and
 * official, and every individual step succeeded. The only place the mismatch is
 * visible is here, by asking whether the pages contain the words the question
 * was about.
 *
 * Returns 0 to 1. Computed on the question's DISTINCTIVE terms — `queryTerms`
 * has already dropped the stopwords, so "the" and "how" cannot inflate it.
 */
export function termCoverage(question: string, sources: { text: string; label: string }[]): number {
  const terms = queryTerms(question);
  if (!terms.length || !sources.length) return 1;

  /* One bag for all the sources rather than per-source: a question spanning two
     topics may legitimately have each half answered by a different page, and
     scoring them separately would call that a miss. */
  const bag = new Set(sources.flatMap((source) => tokenize(`${source.label} ${source.text}`)));
  const found = terms.filter((term) => bag.has(term)).length;

  return found / terms.length;
}

/* WHAT THE QUESTION IS ABOUT, AS OPPOSED TO WHAT IT SAYS.
 *
 * `termCoverage` above counts how many of a question's distinctive words appear
 * in the pages, and it can be comfortably passed by pages about nothing. Asked
 * to analyse Nvidia as an investment, retrieval returned "2025 in the United
 * States" and "Julia (programming language)". Between them those two pages
 * contain "revenue", "growth", "debt", "cash", "free" and "2026" — most of the
 * question's vocabulary — so coverage read as adequate and the turn proceeded to
 * answer from them. The one word that mattered, the name of the company, was in
 * neither.
 *
 * A proper noun is the part of a question that cannot be satisfied by a page on
 * a related subject. If NONE of them appear anywhere in the retrieved text, the
 * pages are not about the thing that was asked about, whatever their word
 * overlap says.
 *
 * Sentence-initial capitals are excluded because every sentence has one. A
 * question typed in lower case yields nothing here, which is the safe direction:
 * the check can only ever add a warning, never suppress one.
 */
const NOT_A_SUBJECT = new Set([
  'the', 'a', 'an', 'i', 'we', 'my', 'our', 'is', 'are', 'do', 'does', 'can', 'could', 'should',
  'what', 'which', 'who', 'when', 'where', 'why', 'how', 'and', 'or', 'but', 'if', 'in', 'on',
  'at', 'to', 'for', 'of', 'as', 'it', 'this', 'that', 'give', 'tell', 'explain'
]);

export function subjectTerms(question: string): string[] {
  const terms = new Set<string>();

  for (const sentence of question.split(/(?<=[.!?])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/);

    words.forEach((word, index) => {
      const clean = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (index === 0 || clean.length < 2) return;
      if (!/^\p{Lu}/u.test(clean)) return;
      if (NOT_A_SUBJECT.has(clean.toLowerCase())) return;
      terms.add(clean);
    });
  }

  return [...terms];
}

/**
 * True when the pages mention none of the question's proper nouns at all.
 *
 * Deliberately unanimous: one subject term found is enough to say the retrieval
 * landed somewhere near the question. This fires only when it landed nowhere.
 */
export function missesTheSubject(question: string, sources: { text: string; label: string }[]): boolean {
  const terms = subjectTerms(question);
  if (!terms.length || !sources.length) return false;

  const haystack = sources.map((source) => `${source.label} ${source.text}`).join(' ').toLowerCase();
  return terms.every((term) => !haystack.includes(term.toLowerCase()));
}

/* A figure fetched by name, dressed as a source that was read.
 *
 * Everything downstream — the prompt builder, the citation list, the council's
 * re-slicing — expects an `EvidenceSource` wrapped around a `Page`. Market data
 * is not a page and was never fetched as one, so a `Page` is synthesised around
 * the text rather than the pipeline being taught a second shape of evidence.
 * The alternative is an optional `page` and a null check at every use of it.
 *
 * `contentScore` is deliberately high: this source was retrieved because the
 * question named the company, not because it ranked against a query, and the
 * relevance floor would otherwise measure a balance sheet for word overlap with
 * a sentence. */
function asEvidenceSource(source: MarketSource): EvidenceSource {
  return {
    label: source.label,
    url: source.url,
    text: source.text,
    publishedAt: source.publishedAt,
    authority: source.authority,
    contentScore: Number.MAX_SAFE_INTEGER,
    page: {
      url: source.url,
      title: source.label,
      domain: new URL(source.url).hostname,
      text: source.text,
      sections: [{ title: source.label, text: source.text }],
      truncated: false,
      length: source.text.length,
      authority: source.authority,
      retrievedAt: source.retrievedAt,
      publishedAt: source.publishedAt,
      cached: false,
      via: 'html'
    }
  };
}

/* Primary sources first.
   Position carries weight the instructions cannot fully overcome, so the body
   that makes the rule is read before anyone summarising it. */
const AUTHORITY_ORDER: Record<string, number> = { official: 0, legal: 1, reputable: 2, unverified: 3 };

export function byAuthority(a: { authority: string }, b: { authority: string }): number {
  return (AUTHORITY_ORDER[a.authority] ?? 3) - (AUTHORITY_ORDER[b.authority] ?? 3);
}

/**
 * Search, choose, and read.
 *
 * `queries` have already passed the egress gate — this function does not
 * re-check them, because the caller is where a query is built and therefore
 * where a leak would originate.
 */
export async function gatherEvidence(
  question: string,
  queries: string[],
  budget: EvidenceBudget,
  onStage: (stage: string, detail?: string) => void = () => {}
): Promise<GatheredEvidence> {
  /* Decided from the QUESTION, not from each query. The planner writes keywords
     — "AI industry announcements September 2026" — and drops the word that said
     the person wanted today's news rather than a summary of the field. */
  const includeNews = looksLikeNewsQuestion(question);

  /* Filings and quotes are fetched alongside the searches rather than after
     them. They are not pages and cannot be found by searching for them: a
     question about a company's free cash flow has no candidate page anywhere in
     the lanes this pipeline knows, which is exactly how it came to cite
     "Julia (programming language)". See `research/markets`. */
  const marketWork = looksLikeCompanyQuestion(question)
    ? marketEvidence(question).catch(() => [] as MarketSource[])
    : Promise.resolve([] as MarketSource[]);

  const [outcomes, market] = await Promise.all([
    Promise.all(queries.map((query) => search(query, { includeNews }))),
    marketWork
  ]);

  if (market.length) onStage('reading', `${market.length} market source(s)`);

  /* Deduplicate across queries by URL.
   *
   * Three related queries return the same authoritative page three times, and
   * without this every copy occupies a source slot. Observed directly: a
   * five-source budget spent three slots on one GOV.UK page and left two for
   * everything else, so a stale third-party summary carried as much weight in
   * the answer as the publisher of the rule. */
  const seen = new Set<string>();
  /* EVERY query that found a page, not just the first.
   *
   * A pass runs several queries because the question has several parts, and the
   * part a page answers is knowable only from the query that found it. Recording
   * one index — the first — looked equivalent and was not: a broad opening query
   * ("skilled worker global talent") also returns the Global Talent page, so the
   * page was attributed to that query, and the query written specifically for it
   * had no claim on anything. The fairness rules below then protected the wrong
   * page and read "Family visas" instead. */
  const foundBy = new Map<string, Set<number>>();

  const merged = outcomes
    .flatMap((outcome, queryIndex) => outcome.results.map((result) => ({ result, queryIndex })))
    .filter(({ result, queryIndex }) => {
      const key = result.url.replace(/#.*$/, '').replace(/\/$/, '');
      const queries = foundBy.get(result.url) ?? new Set<number>();
      queries.add(queryIndex);
      foundBy.set(result.url, queries);

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ result }) => result);

  if (!merged.length) {
    /* Market figures are a complete answer to some questions on their own, so a
       search that found nothing is only fatal when they are absent too. */
    if (market.length) return { sources: market.map(asEvidenceSource), discarded: 0 };

    throw new Error(
      'No source answered any of the searches. ' + outcomes.map((o) => o.note).filter(Boolean).join(' ')
    );
  }

  /* Half the pages are reserved for primary publishers, because on an
     immigration question the body that makes the rule outranks everyone
     describing it.
   *
   * A NEWS QUESTION INVERTS THAT, and the reservation was quietly costing it.
   * There is rarely a GOV.UK page about what the AI industry did yesterday, so
   * three of five slots sat empty while the newsrooms that did have the story
   * competed for two — and a question asking for three stories came back with
   * two, correctly refusing to invent a third. The split follows what the
   * question can actually be answered by. */
  const officialWanted = includeNews ? Math.floor(budget.pages / 3) : Math.ceil(budget.pages / 2);
  const generalWanted = budget.pages - officialWanted;

  /* Ask for more primary sources than will be used, and decide between them on
   * what the pages SAY rather than what they are called.
   *
   * A title is too little signal to pick between government pages. GOV.UK's own
   * index is a candidate pool, not a ranking, and the page that states the rule
   * is often titled in the publisher's vocabulary rather than the asker's — so
   * it shares fewer words with the question than pages that do not answer it at
   * all. Reading a few more and scoring the content does separate them. */
  /* ON A NEWS QUESTION, AN AGGREGATOR DOES NOT COMPETE WITH A NEWSROOM.
   *
   * The first fix here was a prompt rule, and it was not enough. With the feeds
   * in place, a question about the day's AI stories still came back with a
   * content farm as two of its three items: the answer dutifully noted that only
   * one source was reputable and then reported all three anyway, including a
   * signed bill and a security incident that exist nowhere else. By the time the
   * page is in the dossier it is also the most quotable thing in it, because an
   * aggregator writes in headlines and a newsroom writes in paragraphs.
   *
   * Filtered HERE, among the candidates, rather than after reading: a page ruled
   * out later has already taken a page slot and a share of the budget from a
   * publisher that had the story. That is how a question asking for three
   * stories came back with one.
   *
   * Only on news questions, and only when something better exists. A question
   * about a rule still reads whatever it finds, and a news question that turned
   * up nothing but unverified pages keeps them and says so — a gap reported is
   * recoverable, a gap filled from a content farm is not. */
  const editorial = merged.filter((result) => result.authority !== 'unverified');
  /* The same reasoning covers a company question. Once the filings and the quote
     are in hand, an encyclopaedia page that mentions the year is not adding a
     source — it is adding something for a reader to check the answer against
     that had no part in producing it. Observed: "2025 in the United States"
     listed under an analysis written entirely from SEC data. */
  const preferEditorial = includeNews || market.length > 0;
  const candidates = preferEditorial && editorial.length ? editorial : merged;
  const aggregators = merged.length - candidates.length;

  if (aggregators > 0) {
    onStage('searching', `${aggregators} result(s) with no editorial standing set aside`);
  }

  const selection = selectSources(question, candidates, {
    official: officialWanted + budget.officialOversample,
    general: generalWanted
  });

  /* EVERY QUERY GETS ITS BEST PAGE READ, WHATEVER THE POOL DOES.
   *
   * Selection ranks one merged pool against the WHOLE question, and on a
   * comparison that is the wrong contest. Asked to compare two visa routes,
   * GOV.UK returned 38 candidates for each of three queries; the Skilled Worker
   * pages took all five official slots because the question names that route
   * first and repeats its vocabulary, and the Global Talent page — the FIRST
   * result of the query written specifically for it — was never read at all.
   * Every row of the second column then said "not covered by the supplied
   * sources", which reads like honesty and is a retrieval failure.
   *
   * Each query's own best result is added here, ranked against THAT query rather
   * than against the whole question. It costs one extra page fetch per query and
   * is the only point where the pass still knows which question each page was
   * found for. */
  const claimants = queries
    .map((query, index) => {
      const own = candidates.filter((result) => foundBy.get(result.url)?.has(index));
      return own.length ? rankResults(query, own)[0] : undefined;
    })
    .filter((result): result is NonNullable<typeof result> => Boolean(result));

  const urlsToRead = [...new Set([...selection.all, ...claimants].map((result) => result.url))];
  const added = urlsToRead.length - selection.all.length;

  onStage('reading', `${urlsToRead.length} sources${added > 0 ? ` (${added} to cover every part of the question)` : ''}`);
  const { pages } = await readPages(urlsToRead);
  if (!pages.length) throw new Error('Every source found was unreadable.');

  /* Budget per source by authority, not evenly.
     An even split spends as much context on an encyclopaedia summary as on the
     page that states the rule. */
  const shareFor = (authority: string): number =>
    isPrimary(authority) ? budget.perPage * 2 : Math.round(budget.perPage * 0.6);

  const read: EvidenceSource[] = pages.map((page: Page) => {
    const reading = selectReading(page, question, shareFor(page.authority));
    return {
      label: page.title,
      url: page.url,
      text: reading.text,
      publishedAt: page.publishedAt,
      authority: page.authority,
      page,
      contentScore: reading.chosen.reduce((total, entry) => total + entry.score, 0)
    };
  });

  /* Drop the oversampled primary sources that the pages themselves rule out.
   *
   * AT MOST THE OVERSAMPLE IS DISCARDED, which is the whole correction here.
   * Discarding everything beyond `officialWanted` assumed the primary lane is
   * the only place a primary source can come from, and it is not: the general
   * lane ranks by relevance and frequently selects an official page too. On
   * Spark, which takes no oversample at all, that logic threw away one of only
   * two sources and answered from a single page — a source the selector had
   * deliberately chosen, deleted by a step that exists only to undo
   * deliberate over-fetching.
   *
   * The weakest are dropped, not the first past the line, because the surplus
   * is ordered best-first. */
  const primaryRead = read
    .filter((source) => isPrimary(source.authority))
    .sort((a, b) => b.contentScore - a.contentScore);

  const surplus = primaryRead.slice(officialWanted);
  const overSampled = budget.officialOversample > 0 ? surplus.slice(-budget.officialOversample) : [];

  /* EXCEPT THE BEST PAGE EACH QUERY FOUND, WHICH IS NEVER DISCARDED.
   *
   * Asked to compare two visa routes across five criteria, a pass read seven
   * pages and answered from two, both about the same route — every row of the
   * other half of the table said "not established in the sources". The Global
   * Talent page was retrieved, as the first result of the query written for it,
   * and then dropped right here as one of the two weakest primary sources.
   *
   * It genuinely does score lower against the whole question: the question names
   * Skilled Worker first and "salary" and "sponsorship" appear all over that
   * guidance. Scoring against the whole question is the right measure for
   * ranking and the wrong one for deciding what to throw away, because a
   * multi-query pass has several questions in it. One page per query survives;
   * everything beyond that competes on score as before. */
  /* The claimants are already exactly this: one page per query, ranked against
     that query rather than against the whole question. Protecting the same set
     here keeps one decision in one place. */
  const bestOfQuery = new Set(claimants.map((result) => result.url));

  const discarded = overSampled.filter((source) => !bestOfQuery.has(source.url));

  if (discarded.length) {
    onStage('reading', `${discarded.length} primary source(s) did not address the question`);
  }

  const kept = read.filter((source) => !discarded.includes(source));

  /* DROP THE PAGES THAT CONTRIBUTED NOTHING, RATHER THAN CITING THEM.
   *
   * Observed, and the reason this exists: a question about the team's own
   * billable-hours arithmetic came back with "Visit the UK as a Standard
   * Visitor" listed as a source. The page was real, official, and had precisely
   * nothing to do with the question — it was simply the best thing a search for
   * those words could find on a government domain. The answer was then correct
   * with a nonsense citation attached, which is the worst combination: the
   * citation is what a reader checks the answer against, so a wrong one is
   * actively misleading in a way that no citation would not be.
   *
   * Judged RELATIVE to the best page rather than against a fixed score, because
   * scores are not comparable between questions — a rare-term question scores
   * high across the board and a common-term one scores low across the board.
   * What is comparable is how a page did against the best page for the same
   * question.
   *
   * The best source is always kept. A pass where every page scored badly is a
   * pass with weak evidence, and that is reported (see `termCoverage`) rather
   * than turned into a pass with no evidence at all. */
  const best = Math.max(...kept.map((source) => source.contentScore), 0);
  const floor = best * 0.15;
  /* The best page each query found is exempt, for the reason given at the
     discard above: it is measured against the WHOLE question, and on a
     comparison the page answering the second half necessarily scores against
     wording that is mostly about the first. Protecting it from the oversample
     discard alone was not enough — the Global Talent page cleared that and was
     then dropped here instead, which is why the second column of the table still
     read "not covered by the supplied sources". */
  const useful =
    best > 0
      ? kept.filter((source) => source.contentScore >= floor || bestOfQuery.has(source.url))
      : kept;
  const irrelevant = kept.length - useful.length;

  if (irrelevant > 0) {
    onStage('reading', `${irrelevant} source(s) had nothing to do with the question and were dropped`);
  }

  /* Market sources join AFTER the relevance floor, never through it. They were
     fetched by name rather than found by searching, so there is no ranking
     against a query to score them on — and scoring a filing's figures for word
     overlap with the question would drop the very thing the question asked
     for. */
  /* EACH QUERY GETS ITS BEST SOURCE IN FIRST.
   *
   * Asked to compare two visa routes across five criteria, a pass read seven
   * pages and answered from two, both about the same route — every row of the
   * other half of the table read "not established in the sources". Nothing had
   * failed. The Skilled Worker guidance is enormous, both of its pages ranked
   * above the Global Talent page for a question that names Skilled Worker first,
   * and they filled the prompt before it was reached.
   *
   * Ranking cannot fix that, because both pages genuinely are relevant. What was
   * missing is that a multi-query pass has multiple QUESTIONS in it, and the
   * budget was being spent as though it had one. So sources are dealt out in
   * rounds: the best page from each query, then the second from each, and so on.
   * Authority still comes first — the body that makes the rule is still read
   * before anyone summarising it — and this decides the order inside each tier.
   */
  const chosen = useful.length ? useful : kept;
  const perQueryRank = new Map<string, number>();
  const counts = new Map<number, number>();

  for (const source of chosen) {
    /* The query that claimed this page if one did, otherwise the first that
       found it. A page several queries returned is dealt on behalf of the one
       that wanted it most specifically. */
    const claimIndex = claimants.findIndex((claimant) => claimant.url === source.url);
    const queryIndex = claimIndex >= 0 ? claimIndex : ([...(foundBy.get(source.url) ?? [])][0] ?? 0);

    const round = counts.get(queryIndex) ?? 0;
    counts.set(queryIndex, round + 1);
    /* The round decides the order; the query index only breaks ties inside one,
       so no single query is systematically favoured beyond its first page. */
    perQueryRank.set(source.url, round * 100 + queryIndex);
  }

  const sources = [...market.map(asEvidenceSource), ...chosen].sort(
    (a, b) =>
      byAuthority(a, b) || (perQueryRank.get(a.url) ?? 0) - (perQueryRank.get(b.url) ?? 0)
  );

  return { sources, discarded: discarded.length + irrelevant + aggregators };
}

/* A ceiling on the WHOLE prompt, not just on each page.
 *
 * Per-page limits multiply: five pages at five thousand characters is a
 * twenty-five thousand character prompt, and past roughly twenty thousand this
 * model returned an empty completion with a 200 status rather than an error.
 * Capping each page individually cannot prevent that, because the failure is a
 * function of the total. Sources are trimmed in the order they will be read —
 * primary first — so what gets cut is the least authoritative material rather
 * than whatever happened to be last. */
export function fitToBudget<T extends { text: string }>(
  sources: T[],
  totalChars: number
): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let spent = 0;

  /* NO SINGLE SOURCE MAY EAT THE WHOLE BUDGET.
   *
   * Asked to compare two visa routes across five criteria, the pass read seven
   * pages — three of them about Global Talent, correctly selected and well
   * scored — and answered from two, both about Skilled Worker. Every row of the
   * second column said "not established in the sources". Nothing upstream had
   * failed. GOV.UK's guidance pages are enormous, the first two filled 14,000
   * characters between them, and the loop stopped there.
   *
   * The ceiling is the budget divided by the number of sources it should fit,
   * capped at four: past that the slices are too thin to state a rule properly.
   * `selectReading` has already chosen each page's most relevant sections, so
   * what a ceiling removes is the tail of an already-ranked reading rather than
   * something the question needed. A single source still gets everything. */
  const perSource =
    sources.length > 1
      ? Math.max(1500, Math.floor(totalChars / Math.min(sources.length, 4)))
      : totalChars;

  for (const entry of sources) {
    if (spent >= totalChars) break;

    const source =
      entry.text.length > perSource
        ? ({ ...entry, text: entry.text.slice(0, perSource) + ' …[trimmed to fit]' } as T)
        : entry;

    const room = totalChars - spent;
    if (source.text.length <= room) {
      kept.push(source);
      spent += source.text.length;
      continue;
    }
    /* A stub too small to contain anything invites the model to guess the rest. */
    if (room > 800) {
      kept.push({ ...source, text: source.text.slice(0, room) + ' …[trimmed to fit]' });
      spent = totalChars;
    }
    break;
  }

  return { kept, dropped: sources.length - kept.length };
}
