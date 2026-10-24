/* Choosing what the model actually reads.
 *
 * A model's context is the scarcest thing in this pipeline, and how it is spent
 * decides whether an answer is right. The failure this module exists to prevent
 * is specific and was observed: the Skilled Worker guide is 57,373 characters
 * across fifteen chapters, the salary figures are in chapter three, and an
 * extractor that keeps "the first 12,000 characters" hands over the overview,
 * the English-language requirement, and nothing about salary. The model then has
 * the right page and cannot answer from it.
 *
 * So selection is by relevance, not by position. Ranking is deliberately
 * lexical — term overlap weighted by how rare a term is across the candidates —
 * rather than embedding-based. Immigration questions turn on exact tokens
 * ("threshold", "£41,700", "CoS", "22 July 2025") and a lexical scorer matches
 * those exactly, needs no model call, no key and no network, and stays
 * explainable when a selection looks wrong.
 */

import type { Page, Section } from './read-page';
import type { SearchResult } from './search';

/* Words that carry no signal for ranking. Kept short on purpose: an aggressive
   stoplist removes terms that matter in this domain — "no recourse", "leave to
   remain", and "right to work" all hinge on words a generic list discards. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'doing', 'have', 'has', 'had', 'having',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'they', 'them', 'their',
  'this', 'that', 'these', 'those', 'and', 'or', 'but', 'if', 'then', 'than',
  'so', 'because', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on',
  'to', 'with', 'about', 'what', 'which', 'who', 'whom', 'how', 'when', 'where',
  'why', 'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might',
  'must', 'need', 'there', 'here', 'also', 'any', 'some', 'all', 'both', 'each'
]);

export function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    /* Keep £, %, and digits joined to their number: "£41,700" and "41700" must
       remain matchable tokens, because they are frequently the whole answer. */
    .replace(/[^a-z0-9£%.,\-\s]/g, ' ')
    .split(/\s+/)
    /* The hyphen sits last in the class so it is a literal rather than a range,
       which is why it needs no escape here. */
    .map((token) => token.replace(/^[.,-]+|[.,-]+$/g, ''))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** Distinct query terms, in order, with duplicates removed. */
/* The readable words in a URL's path.
 *
 * Only the path: the host contributes "www", "gov" and "uk" to every GOV.UK
 * result equally, which is noise that inflates every document's length without
 * distinguishing any of them. Separators become spaces so `long-residence`
 * tokenises as two words, and a trailing file extension is dropped. */
export function slugWords(url: string): string {
  try {
    return new URL(url).pathname
      .replace(/\.(html?|php|aspx?)$/i, '')
      .replace(/[/_.-]+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query))];
}

/* A term appearing in every candidate separates nothing; a term appearing in one
   separates everything. This is the inverse-document-frequency idea, kept in the
   simplest form that behaves correctly on the small candidate sets here (a page
   has tens of sections, not millions). */
function inverseFrequency(term: string, documents: string[][]): number {
  const containing = documents.reduce((count, tokens) => count + (tokens.includes(term) ? 1 : 0), 0);
  return Math.log(1 + documents.length / (1 + containing));
}

export interface ScoredSection {
  section: Section;
  score: number;
  /** Which query terms this section actually contains. Shown in the process panel so a selection is auditable. */
  matched: string[];
}

/* Signals that a passage states a rule rather than describing one, which is
   what a question about a threshold, a fee or a deadline is looking for. */
const FIGURE_PATTERN = /£\s?[\d,]+|\d+\s?%|\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b|\b\d+\s+(years?|months?|days?|weeks?)\b/i;

/* Question shapes that are answered by a number or a date rather than by prose. */
const WANTS_FIGURE = /\b(how much|how many|how long|threshold|salary|minimum|maximum|fee|cost|price|rate|deadline|when|amount|limit|age|duration|valid)\b/i;

/* What KIND of figure the question wants.
 *
 * Promoting "a section containing any figure" is not enough, and the failure was
 * specific. Asked "what is the minimum salary… and when did it change?", the
 * word "change" scored two sections about CHANGING JOB above the section stating
 * the salary. Both contained a figure — a date, "22 July 2025" — so an
 * any-figure rule considered itself satisfied and left the money section out
 * entirely. The model then reported that the official page did not state a
 * salary and fell back to a stale third-party page.
 *
 * Matching the kind of figure to the kind of question is what fixes it: a
 * question about money must be answered from a passage containing money. */
const FIGURE_KINDS: { asks: RegExp; pattern: RegExp }[] = [
  {
    asks: /\b(salary|wage|pay|paid|earn|income|threshold|fee|cost|price|charge|funds|maintenance|financial|money|afford)\b/i,
    pattern: /£\s?[\d,]+/
  },
  {
    asks: /\b(how long|duration|period|wait|valid(?:ity)?|expire|continuous|residence|years?|months?)\b/i,
    pattern: /\b\d+\s+(?:years?|months?|weeks?|days?)\b/i
  },
  {
    asks: /\b(when|date|deadline|from what|effective|introduced|came into force)\b/i,
    pattern:
      /\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i
  },
  { asks: /\b(percent|percentage|rate|proportion|share)\b/i, pattern: /\d[\d.]*\s?%/ }
];

/* How many passages of the wanted kind are promoted. Three covers the common
   shape of a UK rule page — a general figure, an exception, and a transitional
   case — without crowding out the sections that explain them. */
const PROMOTED_FIGURE_SECTIONS = 3;

function wantedFigureKind(query: string): { pattern: RegExp } | null {
  /* First match wins, and the order is deliberate: money is the most consequential
     thing to get wrong and the most commonly asked, so it is checked first even
     when a question mentions both an amount and a date. */
  return FIGURE_KINDS.find((kind) => kind.asks.test(query)) ?? null;
}

/**
 * Rank a page's sections against a question.
 *
 * Score is term overlap weighted by term rarity, plus a bonus when a query term
 * appears in the section's own heading (a chapter called "Salary requirements"
 * is a stronger signal than the word "salary" buried in a paragraph), plus a
 * bonus when the question wants a figure and the section contains one.
 */
export function scoreSections(query: string, sections: Section[]): ScoredSection[] {
  const terms = queryTerms(query);
  if (!terms.length || !sections.length) {
    return sections.map((section) => ({ section, score: 0, matched: [] }));
  }

  const documents = sections.map((section) => tokenize(section.title + ' ' + section.text));
  const wantsFigure = WANTS_FIGURE.test(query);

  return sections.map((section, index) => {
    const tokens = documents[index]!;
    const titleTokens = new Set(tokenize(section.title));
    const matched: string[] = [];
    let score = 0;

    for (const term of terms) {
      const occurrences = tokens.reduce((count, token) => count + (token === term ? 1 : 0), 0);
      if (occurrences === 0) continue;
      matched.push(term);

      /* Saturating count: the tenth mention of a term says little more than the
         third, and without this a long section wins purely by being long. */
      const saturated = occurrences / (occurrences + 2);
      score += saturated * inverseFrequency(term, documents);
      if (titleTokens.has(term)) score += 0.8;
    }

    if (wantsFigure && FIGURE_PATTERN.test(section.text)) score += 0.6;

    /* A section too short to contain an answer is usually a nav stub or a
       heading with one line under it. */
    if (section.text.length < 120) score *= 0.3;

    return { section, score, matched };
  });
}

export interface SelectedReading {
  /** Sections chosen, best first. */
  chosen: ScoredSection[];
  /** Assembled text, within budget, ready to be wrapped as untrusted content. */
  text: string;
  /** True when relevant material was dropped for budget — the answer should say so. */
  omitted: boolean;
  /** Query terms found nowhere on the page. A question the page does not address is itself a finding. */
  missingTerms: string[];
}

/* Reduce one section to the sentences that answer the question.
 *
 * Whole sections are too big to be the unit of selection. On the Skilled Worker
 * guide a chapter runs to five or six thousand characters, so the first one
 * chosen consumed the entire budget and the other figures — which are what the
 * question is actually between — never reached the model at all.
 *
 * Sentences are scored and kept IN THEIR ORIGINAL ORDER, because a rule read out
 * of order changes meaning: "whichever is higher" is useless above the two
 * amounts it refers to, and a condition sentence lifted away from its exception
 * reverses the answer. Neighbours of a kept sentence are pulled in for the same
 * reason — a figure with no sentence around it is a number without its
 * condition. */
function condenseSection(section: Section, query: string, wanted: { pattern: RegExp } | null, cap: number): string {
  if (section.text.length <= cap) return section.text;

  const sentences = section.text.split(/(?<=[.!?])\s+(?=[A-Z£])/).filter((s) => s.trim().length > 0);
  if (sentences.length < 2) return section.text.slice(0, cap);

  const terms = queryTerms(query);
  const scores = sentences.map((sentence) => {
    const lower = sentence.toLowerCase();
    let score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    /* A sentence stating the kind of figure asked for is what the question is
       for, so it outweighs one merely discussing the topic. */
    if (wanted?.pattern.test(sentence)) score += 4;
    return score;
  });

  const keep = new Set<number>();
  const order = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score || a.index - b.index);

  let spent = 0;
  for (const { score, index } of order) {
    if (score <= 0) break;
    for (const neighbour of [index, index + 1]) {
      if (neighbour >= sentences.length || keep.has(neighbour)) continue;
      const length = sentences[neighbour]!.length + 1;
      if (spent + length > cap) continue;
      keep.add(neighbour);
      spent += length;
    }
    if (spent >= cap) break;
  }

  if (!keep.size) return section.text.slice(0, cap);

  const indexes = [...keep].sort((a, b) => a - b);
  const parts: string[] = [];
  let previous = -1;
  for (const index of indexes) {
    if (previous !== -1 && index > previous + 1) parts.push('…');
    parts.push(sentences[index]!.trim());
    previous = index;
  }
  return parts.join(' ');
}

/**
 * Pick the parts of a page worth spending context on.
 *
 * Sections are taken best-first until the budget is spent. A page whose best
 * section scores nothing still returns its opening — a page that turned out to
 * be irrelevant should read as irrelevant to the model rather than as empty.
 */
export function selectReading(page: Page, query: string, budget = 6000): SelectedReading {
  let scored = scoreSections(query, page.sections).sort((a, b) => b.score - a.score);
  const terms = queryTerms(query);

  /* If the question wants a figure, make sure a section containing one is read.
   *
   * This is the fix for the worst failure this pipeline has produced. Asked for
   * the Skilled Worker salary threshold, ranking chose sections that discussed
   * salary without stating it, and the model reported that "the official page
   * does not list the salary threshold in the excerpt provided" — then answered
   * from a stale third-party page instead. The authoritative figure was on the
   * page, in a section that scored fractionally lower.
   *
   * Term overlap cannot see the difference between a passage ABOUT a threshold
   * and a passage that STATES one. When the question asks for a number, the
   * section carrying a number is promoted so it cannot be edged out. */
  const wanted = wantedFigureKind(query);
  let promoted: ScoredSection[] = [];

  if (wanted) {
    const carries = (entry: ScoredSection) => entry.score > 0 && wanted.pattern.test(entry.section.text);

    /* Take the best FEW passages of the right kind, not just one.
     *
     * One is not enough, and the reason is instructive. On the Skilled Worker
     * guide, "Extend your visa" states £31,300 and "Your job" states £41,700 —
     * both are money, both are real, and only the second answers "what is the
     * current general minimum". Nothing in term overlap distinguishes the
     * applicable figure from an adjacent one; that judgement needs the meaning
     * of the surrounding rule, which is the model's job and not a scorer's.
     *
     * So retrieval optimises for RECALL — get the candidate figures in front of
     * the model — and precision is left to the reader that can actually weigh
     * them. Promoting exactly one passage produced a confident answer built on
     * whichever figure happened to rank first. */
    promoted = scored.filter(carries).slice(0, PROMOTED_FIGURE_SECTIONS);
    if (promoted.length) {
      scored = [...promoted, ...scored.filter((entry) => !promoted.includes(entry))];
    }
  }

  const found = new Set(scored.flatMap((entry) => entry.matched));
  const missingTerms = terms.filter((term) => !found.has(term));

  const chosen: ScoredSection[] = [];
  const parts: string[] = [];
  let spent = 0;
  let omitted = false;

  /* No single section may take more than this share of the budget, so several
     passages reach the model instead of one long one crowding out the rest. */
  const perSectionCap = Math.max(700, Math.floor(budget / 4));

  /* Promoted passages are placed FIRST and get their space reserved.
   *
   * Filling greedily in score order was not enough. The three money sections
   * were correctly promoted, then the third — the one stating the general
   * £41,700 threshold — did not fit, was skipped, and a smaller, less relevant
   * section slid into the gap behind it. The budget was spent, the answer was
   * absent, and nothing in the output said so. Reserving the promoted set
   * before anything else may compete for room is what stops a cheaper section
   * displacing the one that answers the question. */
  const place = (entry: ScoredSection): boolean => {
    const condensed = condenseSection(entry.section, query, wanted, perSectionCap);
    const block = `## ${entry.section.title}\n${condensed}`;
    if (spent + block.length > budget) {
      omitted = true;
      return false;
    }
    parts.push(block);
    chosen.push(entry);
    spent += block.length;
    return true;
  };

  for (const entry of promoted) {
    if (entry.score > 0) place(entry);
  }
  for (const entry of scored) {
    if (entry.score <= 0 || promoted.includes(entry)) continue;
    place(entry);
  }

  if (!parts.length) {
    const opening = page.text.slice(0, Math.min(budget, 1500));
    return {
      chosen: [],
      text: opening,
      omitted: page.text.length > opening.length,
      missingTerms
    };
  }

  return { chosen, text: parts.join('\n\n'), omitted, missingTerms };
}

/* ---------- ranking search results ---------- */

const AUTHORITY_BONUS: Record<SearchResult['authority'], number> = {
  official: 2.5,
  legal: 2,
  reputable: 0.8,
  unverified: 0
};

/**
 * Order search results by how well they answer the question, using authority as
 * a strong bonus rather than as the primary key.
 *
 * Sorting by authority alone was tried and was actively harmful: asked for the
 * Skilled Worker salary threshold, GOV.UK's own search returned "Check if you
 * need a UK visa" and "Tax-Free Childcare", and an authority-first sort promoted
 * both above the pages that carried the figure. An authoritative page that does
 * not address the question is not a better source — it is a worse one, because
 * its authority makes a wrong selection look deliberate.
 */
export function rankResults(query: string, results: SearchResult[]): SearchResult[] {
  const terms = queryTerms(query);
  if (!terms.length) return results;

  const documents = results.map((result) => tokenize(`${result.title} ${result.snippet} ${slugWords(result.url)}`));

  return results
    .map((result, index) => {
      const tokens = documents[index]!;
      const titleTokens = new Set(tokenize(result.title));
      const slugTokens = new Set(tokenize(slugWords(result.url)));
      let score = 0;

      for (const term of terms) {
        if (!tokens.includes(term)) continue;
        score += inverseFrequency(term, documents);
        if (titleTokens.has(term)) score += 0.7;
        /* THE URL IS A TITLE THE PUBLISHER CANNOT PAD.
         *
         * `gov.uk/long-residence` is the page stating the long-residence rule,
         * and its slug says so more plainly than its title does. Scoring only
         * title and snippet missed it entirely: asked "long residence ILR 10
         * years 210 days absent", the applicant's own numbers dominated the
         * ranking and the top four results were Student visa, citizenship, ETA
         * and "Check if you need a UK visa" — while the right page sat further
         * down the same 42 results. The same query with the numbers removed put
         * it first.
         *
         * A slug is also the one part of a page that search engine optimisation
         * cannot inflate with the question's own words, which is why the bonus
         * is worth as much as the title's. */
        if (slugTokens.has(term)) score += 0.7;
      }

      /* Proportion of the question the result addresses at all. A result
         matching one term out of six is usually about something else. */
      const coverage = terms.filter((term) => tokens.includes(term)).length / terms.length;
      score *= 0.4 + coverage;

      /* Authority lifts a relevant result above an equally relevant one, and is
         gated on the result addressing the question at all. Gating rather than
         scaling is what keeps an authoritative page about something else — the
         GOV.UK childcare page, for a salary question — out of the top of the
         list entirely, instead of merely lower down it.
         Gated on a term COUNT, not a share, for the reason given in
         `selectSources`: a share silently withdraws the bonus from every
         official page as soon as the question gets long. */
      const matched = terms.filter((term) => tokens.includes(term)).length;
      if (matched >= Math.min(MIN_TERMS_FOR_AUTHORITY, terms.length)) {
        score += AUTHORITY_BONUS[result.authority];
      }

      return { result, score, index };
    })
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
    .map((entry) => entry.result);
}

/* Distinct query terms a result must share before authority counts in its
   favour. Two is deliberately low: this gate only has to exclude results that
   are about something else entirely, and ranking — not the gate — decides the
   order of everything that clears it. Raising it re-introduces the failure it
   was written to fix, in which detailed questions locked out every primary
   source. */
const MIN_TERMS_FOR_AUTHORITY = 2;

export interface SourceSelection {
  /** Primary sources: the body that makes or administers the rule. */
  official: SearchResult[];
  /** Everything else, best first — practitioner commentary, news, explainers. */
  general: SearchResult[];
  /** Both lanes concatenated, official first, ready to be read in order. */
  all: SearchResult[];
}

/**
 * Choose what to read, guaranteeing the primary source is among it.
 *
 * Two lanes rather than one ranked list, because ranking alone cannot fix the
 * underlying bias. Official pages are titled by TOPIC — "Skilled Worker visa" —
 * while commercial pages are titled by QUERY — "UK Skilled Worker Visa Minimum
 * Salary 2026". Search engine optimisation is precisely the practice of making
 * the second kind match a question better than the first, so any scorer built on
 * term overlap will rank the content farm above the Home Office, and tuning the
 * authority weight until it does not is a fight that has to be re-fought every
 * time the weights move.
 *
 * Reserving slots sidesteps it. The primary source is read because it is the
 * primary source, and practitioner pages are read alongside because they are
 * often more current than a government page's own revision date and they name
 * the changes a rule page states without dating.
 */
export function selectSources(
  query: string,
  results: SearchResult[],
  limits: { official?: number; general?: number } = {}
): SourceSelection {
  const officialWanted = limits.official ?? 3;
  const generalWanted = limits.general ?? 3;

  const ranked = rankResults(query, results);
  const terms = queryTerms(query);

  /* A reserved slot is not a free pass: a source still has to address the
     question to occupy one, or the lane fills with authoritative irrelevance.
     But "addresses the question" must not be measured as a SHARE of the
     question, which is the bug this replaces.
     A share makes the bar rise with question length. Official pages are titled
     by topic and are therefore short — "Calculating continuous lawful period:
     caseworker guidance" is the page stating the absence limit, and against a
     twelve-term case summary it can only ever match two or three terms, scoring
     0.17 against a 0.35 bar. So a detailed question rejected EVERY official
     source and answered from immigration firms' blogs, which is exactly
     backwards: the longer and more specific the question, the more the primary
     source matters.
     Counting matched terms instead is scale-free. Two distinctive terms in
     common is weak evidence for a short query and strong evidence for a long
     one, and in both cases it is evidence the page is on topic — which is all
     this gate is asked to decide, since ranking orders what survives it. */
  const addresses = (result: SearchResult): boolean => {
    if (!terms.length) return true;
    const tokens = new Set(tokenize(result.title + ' ' + result.snippet));
    const matched = terms.filter((term) => tokens.has(term)).length;
    /* Short queries have no room to spare a term, so the count requirement is
       capped by the query's own length rather than rejecting the whole lane. */
    return matched >= Math.min(MIN_TERMS_FOR_AUTHORITY, terms.length);
  };

  const isPrimary = (result: SearchResult): boolean =>
    result.authority === 'official' || result.authority === 'legal';

  const official = ranked.filter((result) => isPrimary(result) && addresses(result)).slice(0, officialWanted);
  const general = ranked.filter((result) => !official.includes(result)).slice(0, generalWanted);

  return { official, general, all: [...official, ...general] };
}
