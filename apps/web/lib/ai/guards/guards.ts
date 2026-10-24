/* What is done to an answer before it is shown.
 *
 * A language model produces failures that a prompt alone does not reliably fix,
 * because the prompt is advice and these are structural. Ported from Vantage's
 * `src/syrix/guards.js`, with one guard deliberately left behind.
 *
 * WHAT IS KEPT — the two that earn their place:
 *
 *   IT LEAKS ITS OWN PROCESS. "We need to answer the user… Let's craft the
 *   answer:" arrives at the top of otherwise good replies. Anchoring on what an
 *   ANSWER looks like and dropping what precedes it works. Enumerating the
 *   phrases models use to narrate does not, because there is always another one.
 *
 *   IT INVENTS FIGURES. This is the one that matters here. A wrong salary
 *   threshold, fee or deadline is the worst output this system can produce,
 *   because it is specific, quotable, and acted on. Any figure in an answer that
 *   appears in no retrieved source is flagged.
 *
 * WHAT IS DELIBERATELY NOT PORTED — and this is a product decision, not an
 * oversight:
 *
 *   VANTAGE STRIPS RECOMMENDATIONS. In a trading application, turning "RSI is 28,
 *   so this is a buy" back into "RSI is 28" is right: that product does not give
 *   financial advice, and the guard enforces it.
 *
 *   SYRIX AI MUST NOT DO THAT. It is used by immigration consultants who are paid
 *   to reach a view. An assistant that researches a case thoroughly and then
 *   refuses to say which route it would take, or which of two options is
 *   stronger and why, has done the hard part and withheld the useful part. A
 *   guard that quietly deletes the reasoned conclusion produces an assistant
 *   that reads as evasive and gets distrusted — which is worse than one that
 *   commits and cites its sources.
 *
 *   The protection that replaces it is not censorship but PROVENANCE: say what
 *   you think, show what it rests on, and mark what is not established. A
 *   consultant reviews the answer before it reaches a client, and that review is
 *   the control — not a regex that removes the word "should".
 *
 * NOTHING HERE EVER EMPTIES AN ANSWER. If a guard would remove everything, the
 * original is kept — a blank reply is worse than an imperfect one.
 */

export interface SourceMaterial {
  /** Text actually retrieved from a source. A figure is "supported" if it appears here. */
  text: string;
  label: string;
}

export interface GuardReport {
  text: string;
  /** Figures present in the answer but in no source. Surfaced to the reader, never silently deleted. */
  unsupportedFigures: string[];
  /** What each guard changed, for the process panel. */
  applied: string[];
}

/* ---------- refusal ---------- */

/* THE ANSWER THAT IS NOT AN ANSWER.
 *
 * Observed, twice, in the same sitting. Asked to analyse a company as an
 * investment, the assistant retrieved two pages about nothing relevant and
 * replied that it could not construct an analysis and that any figures would be
 * unsupported speculation. Asked to identify and rank the risks of deploying an
 * AI system in a UK business — a question whose whole content is professional
 * judgement — it retrieved a family-visa page, said no factual basis for the
 * risks was provided in its sources, and stopped.
 *
 * Both were failures of retrieval expressed as refusals to think. Nothing in
 * either question needed a source that could not be found; the second needed no
 * source at all. An assistant that will not answer what it plainly could is the
 * exact complaint this product was built against, and it cannot be fixed by
 * asking the model more nicely — the instruction to answer only from sources is
 * doing its job, and it is the pipeline's business to notice when there are no
 * usable sources and take a different path.
 *
 * SO THIS IS DETECTION, NOT CORRECTION. Nothing here edits the text. It reports
 * that the completion declined, and `answerFromResearch` re-runs the turn as
 * reasoning, which is what should have happened. The one case that must survive
 * is a question that turns on a published rule: there, "the pages I found do
 * not state this, so it needs checking against the source" is the correct
 * answer and must not be replaced by a confident figure from memory.
 *
 * Every pattern is composite — a phrase, not a word — and the whole check is
 * gated on length. "I cannot see the attachment you mentioned" is a useful
 * sentence, and a thorough answer that ends by naming what it could not
 * establish is exactly the output that is wanted. A refusal is short and is
 * about its own inability from the first sentence. */
const REFUSAL = [
  /\b(?:the )?(?:provided |supplied |retrieved |available |given )?sources? (?:contain|include|provide|have|offer) no\b/i,
  /\b(?:do|does) not contain any (?:information|data|details|figures)/i,
  /\bi (?:cannot|can ?not|can't|am unable to) (?:construct|produce|provide|give|offer|compile|create|generate|build|answer|analyse|analyze|assess|identify|rank|evaluate)\b/i,
  /\bwithout [^.]{0,90}\bi (?:cannot|can't|am unable to)\b/i,
  /\b(?:any|such|those) (?:statements?|figures?|claims?|conclusions?)[^.]{0,90}\bwould be (?:unsupported |pure |mere |entirely )?speculat/i,
  /\bwould be required (?:to answer|before|in order)/i,
  /\bno factual basis\b/i,
  /\bcannot be answered (?:from|with|using|on)\b/i
];

const REFUSAL_MAX_CHARS = 1800;

/**
 * Whether a completion declined to answer rather than answering.
 *
 * Length is half the test. A short reply that leads with what it cannot do is a
 * refusal; a full answer that closes by naming an unestablished figure is the
 * behaviour the freshness rules ask for, and must not be caught here.
 */
export function looksLikeRefusal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > REFUSAL_MAX_CHARS) return false;
  return REFUSAL.some((pattern) => pattern.test(trimmed));
}

/* ---------- which sources the answer actually used ---------- */

/* A page that was read is not the same thing as a page the answer stands on.
 *
 * The dossier is assembled before the model writes, so it always contains more
 * than the answer needed — and sometimes something it could not use at all. A
 * question about the day's AI stories came back with three BBC articles and
 * "Check your visa processing time" underneath them, listed as a source. The
 * answer was right and the citation list said it had been researched from a page
 * about visa waiting times.
 *
 * The answer already marks what it relied on, inline, after each claim. So the
 * list under it is built from those marks rather than from what was fetched.
 *
 * NEVER EMPTIES THE LIST. If nothing matches — the model paraphrased its labels,
 * or wrote an answer with no marks at all — every source is kept. Showing what
 * was read is imperfect; showing nothing after a sourced answer is worse. */
const CITATION_MARKER = /\[Source:\s*([^\]]+)\]/g;

/** Normalised to compare a model's rendering of a label with the label itself. */
function citationKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 48);
}

const LABEL_NOISE = new Set(['the', 'a', 'an', 'of', 'for', 'if', 'you', 'have', 'or', 'and', 'to', 'in', 'on', 'gov', 'uk']);

/* Not built on `citationKey`: that truncates to 48 characters so two long
   titles can be compared cheaply, and truncation drops the very words an
   abbreviation shares. "ILR for Skilled Worker" lost its match to "Indefinite
   leave to remain if you have a Skilled Worker…" because the cut landed one
   word before "Worker". */
function labelWords(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 1 && !LABEL_NOISE.has(word));
}

/* A MODEL SHORTENS A LONG TITLE AS OFTEN AS IT COPIES IT.
 *
 * Containment alone was not enough. A source labelled "Indefinite leave to
 * remain if you have a Skilled Worker, Health and Care Worker, T2 or Tier 2
 * visa" was cited as "[Source: ILR for Skilled Worker]" — neither string
 * contains the other, so a page the answer plainly stood on was dropped from its
 * own citation list.
 *
 * DELIBERATELY GENEROUS, because of what this is for. It exists to drop a page
 * the answer had nothing to do with — the visa-processing-time guidance listed
 * under three BBC articles about AI — not to arbitrate between two GOV.UK pages
 * with overlapping titles. Those two are both real sources that were both read,
 * and listing both is honest; dropping the wrong one is not. So the test asks
 * whether the mark's words appear in the label, and near-identical titles are
 * expected to match each other. */
function sameCitation(sourceLabel: string, mark: string): boolean {
  const source = citationKey(sourceLabel);
  if (!source || !mark) return false;
  if (source.includes(mark) || mark.includes(source)) return true;

  const sourceWords = new Set(labelWords(sourceLabel));
  const markWords = labelWords(mark);
  if (!markWords.length || !sourceWords.size) return false;

  const shared = markWords.filter((word) => sourceWords.has(word)).length;
  return shared / markWords.length >= 0.6;
}

export function citedLabels(answer: string): string[] {
  const labels: string[] = [];
  CITATION_MARKER.lastIndex = 0;

  for (let match = CITATION_MARKER.exec(answer); match; match = CITATION_MARKER.exec(answer)) {
    labels.push(match[1]!.trim());
  }

  return labels;
}

/** Keep only the sources the answer cited. */
export function usedSources<T extends { label: string }>(answer: string, sources: T[]): T[] {
  const cited = citedLabels(answer).filter(Boolean);
  if (!cited.length) return sources;

  const used = sources.filter((source) =>
    cited.some((mark) => sameCitation(source.label, citationKey(mark)))
  );

  return used.length ? used : sources;
}

/* ---------- narration ---------- */

/* Anchored to the start of a line and kept specific on purpose. Enumerating
   every phrase a model narrates with does not work — there is always another
   one — so this catches the openings that are unambiguously the model talking
   to itself about the task, and `looksLikeAnswer` does the rest of the work by
   recognising what an answer looks like instead.
   The `now <verb>` and `we must <verb>` forms were added after a council answer
   broke off mid-note to say "Now produce answer in markdown, lead with direct
   answer" and printed it. */
const NARRATION =
  /^(we need to|we should|we must (produce|output|write|keep|aim|give|craft)|the user (is|wants|asks|has)|let me|let's|i need to|i should|first,? i|okay,? (so|let)|alright,? (so|let)|thinking|reasoning|plan:|approach:|i'll (start|begin)|to answer this|now (produce|write|craft|output|give|answer))/i;

/** Whether a line is the model talking to itself about the task. */
export function isNarration(line: string): boolean {
  return NARRATION.test(line.trim());
}

/** Something that looks like the start of an actual answer. */
export function looksLikeAnswer(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  /* A FENCE IS AN ANSWER, AND MISSING THAT DESTROYED TWO OF THEM.
   *
   * Everything else in this list is prose furniture, and a completion that opens
   * with "```python" or "```email" matched none of it. The fence and the lines
   * under it were counted as preamble and cut, so a code answer arrived starting
   * halfway down the file with an unmatched closing fence, and a drafted email
   * lost its recipient. Both looked like the model had produced nonsense.
   *
   * It is the strongest answer-start signal there is: nothing narrates in a
   * fenced block. */
  if (text.startsWith('```')) return true;
  if (/^#{1,6}\s/.test(text)) return true; // a heading
  if (/^[-*•]\s/.test(text)) return true; // a bullet
  if (/^\d+[.)]\s/.test(text)) return true; // a numbered point
  if (/^\*\*[^*]+\*\*/.test(text)) return true; // a bold label
  if (NARRATION.test(text)) return false;
  /* An ordinary sentence of reasonable length. */
  return text.length > 25;
}

export function stripNarration(text: string): string {
  const lines = String(text || '').split('\n');
  let start = -1;

  for (let index = 0; index < Math.min(lines.length, 8); index++) {
    if (looksLikeAnswer(lines[index]!)) {
      start = index;
      break;
    }
  }

  /* No anchor found means narration cannot be told from answer, and cutting
     blindly would produce a blank reply. */
  if (start <= 0) return text;

  const kept = lines.slice(start).join('\n').trim();
  return kept.length > 40 ? kept : text;
}

/* Narration that appears AFTER the answer has started.
 *
 * `stripNarration` finds where the answer begins and drops the preamble, which
 * is the common shape and the only one it was built for. A model that reasons
 * as it writes produces a different shape: it starts answering, then breaks off
 * to talk to itself — "We need to bold figures and dates", "We need to keep
 * under 200 words? Let's aim ~150", "Now produce answer in markdown" — and
 * resumes. Observed in a council answer, where it also consumed the token
 * budget and left the note truncated mid-sentence.
 *
 * Anchoring on the first answer-like line cannot reach any of that, because all
 * of it is downstream of the anchor. These lines are removed wherever they are.
 *
 * Line-by-line rather than paragraph-by-paragraph: narration interleaves with
 * real content inside a single block, and dropping a whole paragraph on one bad
 * line would take the answer with it. */
export function dropInlineNarration(text: string): string {
  const lines = String(text || '').split('\n');
  const kept = lines.filter((line) => !NARRATION.test(line.trim()));

  if (kept.length === lines.length) return text;

  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  /* Never empty an answer: if narration was most of what there was, the reader
     is better served by an untidy answer than by nothing. */
  return out.length > 40 ? out : text;
}

/* ---------- repeated lines ---------- */

function isStructural(line: string): boolean {
  const text = line.trim();
  if (!text) return true;
  if (text.length < 12) return true;

  /* Headings, list items and table rows legitimately recur, so only prose is
     deduplicated.
     Restricting this to EMPTY bullets was wrong: "- passport" belongs under
     both "Documents you'll need" and "Evidence to prepare", and removing the
     second occurrence silently shortens a checklist a consultant is working
     from. Losing an item from a document list is a worse failure than leaving a
     repeated line in. */
  return /^(#{1,6}\s|[-*•]\s|\d+[.)]\s|\|)/.test(text);
}

export function dropRepeats(text: string): string {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const line of String(text || '').split('\n')) {
    const key = line.trim().toLowerCase();
    if (!isStructural(line) && seen.has(key)) continue;
    if (!isStructural(line)) seen.add(key);
    out.push(line);
  }

  const kept = out.join('\n');
  return kept.trim().length > 40 ? kept : text;
}

/* ---------- unsourced figures ---------- */

/* Figures that would change what somebody does: money, percentages, durations,
 * and years. Deliberately narrow — an answer is full of incidental numbers
 * ("section 3", "two options") and flagging those trains the reader to ignore
 * the flag, which is worse than not having one. */
const FIGURE = /£\s?[\d,]+(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?%|\b\d+\s+(?:years?|months?|weeks?|days?)\b|\b(?:19|20)\d{2}\b/gi;

/** Normalise so "£41,700", "£ 41700" and "41,700" compare equal. */
function normaliseFigure(figure: string): string {
  return figure.toLowerCase().replace(/[£,\s]/g, '');
}

/**
 * Find figures the answer states that no retrieved source contains.
 *
 * Reported rather than removed. Deleting the figure leaves a sentence that
 * reads as authoritative and now says nothing — "the threshold is per year" —
 * which is more dangerous than a flagged number the reader can check.
 */
export function unsupportedFigures(answer: string, sources: SourceMaterial[], question = ''): string[] {
  if (!sources.length) return [];

  /* Compare on the NUMBER, not on the number welded to its unit.
   *
   * Requiring "180days" to appear verbatim flagged "180 days" as unsupported
   * when the source said "180 calendar days" — one intervening word defeated
   * the whole check. A guard that fires on correct answers is worse than no
   * guard, because people learn to scroll past it. */
  const sourceNumbers = new Set<string>();
  for (const source of sources) {
    for (const number of source.text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
      sourceNumbers.add(number.replace(/,/g, ''));
    }
  }

  /* Figures the ASKER supplied are not inventions.
     A question stating "9 years and 3 months" and "210 days absent" leaves those
     figures all over the answer; flagging them tells the reader the assistant
     made up their own case facts. */
  const askedNumbers = new Set(
    (question.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((number) => number.replace(/,/g, ''))
  );

  const unsupported = new Set<string>();

  for (const figure of answer.match(FIGURE) ?? []) {
    const digits = figure.replace(/[^\d.]/g, '').replace(/\.$/, '');
    if (!digits) continue;
    if (askedNumbers.has(digits) || sourceNumbers.has(digits)) continue;
    unsupported.add(figure.trim());
  }

  return [...unsupported];
}

/* ---------- tool and citation debris ---------- */

const TOOL_SYNTAX = [
  /<\|?tool_call\|?>[\s\S]*?<\|?\/?tool_call\|?>/gi,
  /^\s*(?:functions?\.)?\w+\(\{[\s\S]*?\}\)\s*$/gim,
  /```(?:tool|function|json)\s*\{[\s\S]*?```/gi
];

export function dropToolSyntax(text: string): string {
  let out = String(text || '');
  for (const pattern of TOOL_SYNTAX) out = out.replace(pattern, '');
  const kept = out.trim();
  return kept.length > 40 ? kept : text;
}

/** Citation markers a model emits when it half-remembers a citation format. */
export function dropCitationMarkers(text: string): string {
  const out = String(text || '')
    .replace(/【[^】]*】/g, '')
    .replace(/\[\s*(?:citation|source|ref)\s*:?\s*\]/gi, '')
    .replace(/\[\d+\]\s*(?=[.,;])/g, '');
  return out.trim().length > 40 ? out : text;
}

/* ---------- the pass ---------- */

/**
 * Clean an answer and report what could not be verified.
 *
 * Order matters: narration is stripped before repeats, because a narrated
 * preamble often restates the question and would otherwise be the line that
 * survives deduplication.
 */
export function clean(
  answer: string,
  sources: SourceMaterial[] = [],
  question = '',
  /* PROSE GUARDS DO NOT BELONG ON A COMPOSED DOCUMENT.
   *
   * `stripNarration` finds where the answer starts by recognising what an
   * ANSWER looks like — a sentence. A drafted email does not start with one: it
   * starts with a fence and a "To:" line, which read as preamble to every test
   * this file applies. Observed, and it destroyed the output: the opening
   * ```email and its recipient were stripped, leaving a body with an unmatched
   * closing fence that the renderer drew as plain text with stray backticks.
   *
   * The guards that still matter for a draft — tool debris, citation debris —
   * run as normal. The two that assume prose are skipped. */
  options: { prose?: boolean } = {}
): GuardReport {
  const applied: string[] = [];
  const original = String(answer || '');
  const prose = options.prose ?? true;
  let text = original;

  if (prose) {
    const afterNarration = stripNarration(text);
    if (afterNarration !== text) applied.push('removed process narration');
    text = afterNarration;

    const afterInline = dropInlineNarration(text);
    if (afterInline !== text) applied.push('removed narration from the body');
    text = afterInline;
  }

  const afterTools = dropToolSyntax(text);
  if (afterTools !== text) applied.push('removed tool syntax');
  text = afterTools;

  const afterCitations = dropCitationMarkers(text);
  if (afterCitations !== text) applied.push('removed stray citation markers');
  text = afterCitations;

  const afterRepeats = dropRepeats(text);
  if (afterRepeats !== text) applied.push('removed repeated lines');
  text = afterRepeats;

  /* The last line of defence against the guards themselves. */
  if (!text.trim()) {
    return { text: original, unsupportedFigures: [], applied: ['guards would have emptied the answer; kept the original'] };
  }

  return { text, unsupportedFigures: unsupportedFigures(text, sources, question), applied };
}
