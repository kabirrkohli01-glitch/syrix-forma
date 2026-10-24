/* The council — Zenith's multi-agent pass.
 *
 * A question like "what are their options and which would you recommend" is not
 * one question. It is several, and they want different evidence and different
 * habits of mind: which route applies, what it costs, what must be evidenced,
 * what expires when, what changed recently, and what would make the whole thing
 * fail.
 *
 * Asking one model all of that at once produces the answer everybody has read a
 * thousand times: four hedged paragraphs that mention every consideration and
 * commit to none. Asking specialists one question each, giving each only the
 * evidence its question needs, and having one of them write the answer from
 * their reports, produces something that reads like a desk.
 *
 * Ported from the Vantage terminal's council, with three design decisions kept
 * because they are the reason it works:
 *
 *   THE MEMBERS ARE SPECIALISTS, NOT COPIES. There is one model behind the
 *   gateway, so asking it the same question seven times averages nothing.
 *   Splitting the QUESTION buys what matters: each pass reads a small, relevant
 *   slice of evidence closely rather than a large one loosely.
 *
 *   THE REVIEW IS AGAINST THE EVIDENCE, NOT AGAINST THE OTHER MEMBERS. Ranking
 *   answers by peer vote rewards the most confident one. The reviewer is given
 *   the dossier and asked what in the answer it does not support.
 *
 *   THE REQUEST BUDGET IS REAL AND IS REPORTED. The roster is trimmed to what
 *   the chain can currently pay for, specialists run in waves rather than all at
 *   once, and the trimming appears IN THE ANSWER rather than being hidden.
 */

import { chainStatus, chat, StoppedError } from '../gateway/client';
import { clean } from '../guards/guards';
import { fitToBudget, type EvidenceSource } from '../pipeline/evidence';
import { selectReading } from '../research/relevance';
import { untrustedContentRules, wrapUntrusted } from '../safety/untrusted';
import { BY_ID, DEFAULT_ROSTER, SPECIALISTS } from './specialists';

export interface CouncilReport {
  id: string;
  title: string;
  ok: boolean;
  text: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  reason: string | null;
}

export interface CouncilResult {
  answer: string;
  roster: { id: string; title: string }[];
  reports: CouncilReport[];
  corrections: string[];
  /** Set when the roster was cut for budget, so the answer can say so. */
  trimmed: string | null;
  unsupportedFigures: string[];
  provider: string;
  model: string;
}

export interface CouncilOptions {
  question: string;
  sources: EvidenceSource[];
  carriesHubContext: boolean;
  signal?: AbortSignal;
  onStage?: (stage: string, detail?: string) => void;
  onToken?: (full: string, delta: string) => void;
}

/* How many specialists run at once. Small enough that the gateway sees a queue
   rather than a burst, large enough that a full council is not minutes of
   waiting. */
const WAVE = 3;

/* Characters of evidence each specialist reads. Deliberately small: the whole
   argument for a council is that each member reads a narrow slice closely. */
const SPECIALIST_EVIDENCE_CHARS = 6_000;

/* A ceiling on the CHIEF'S WHOLE PROMPT, not on the evidence alone.
 *
 * The evidence used to be capped on its own at eight thousand characters, which
 * ignored that the reports sit in the same prompt and grow with the roster. A
 * full six-specialist council pushed the total past the point where this model
 * returns an empty completion with a 200 status, and the chief failed — after
 * six specialist calls had already been spent, producing nothing at all.
 *
 * Budgeting the whole prompt is the only thing that prevents it, for the same
 * reason per-page limits could not prevent it in the single-pass path: the
 * failure is a function of the total. The reports are what the chief is FOR, so
 * they are paid first and the raw evidence takes what is left. */
const CHIEF_PROMPT_CHARS = 13_000;

/* Below this there is not enough evidence to be worth including, and the space
   is better left to the reports. */
const MIN_USEFUL_EVIDENCE = 1_200;

/* The reviewer and the reviser carry the evidence plus the note being checked,
   with no roster of reports to pay for first, so they get a flat allowance. Kept
   well under the chief's ceiling for the same empty-completion reason. */
const REVIEW_EVIDENCE_CHARS = 7_000;

/* How much of the roster the chain can pay for right now.
 *
 * Vantage reads a per-minute allowance off its gateway and sizes the roster to
 * it. This client has no such counter: the gateway enforces allowances on its
 * own side and answers 429, which the chain turns into a cooling provider.
 *
 * COUNTING PROVIDERS IS THE WRONG SIGNAL, and sizing the roster by it was a
 * real defect — the shipped configuration is deliberately ONE link long, a
 * gateway holding every key and failing over internally, so "only one provider
 * is live" describes a healthy production deployment rather than a constrained
 * one. Trimming on it cut the council to four specialists on a correctly
 * configured system, for no reason, permanently.
 *
 * So the roster is only cut when something has ACTUALLY refused. Every provider
 * cooling means the allowance is genuinely spent and the run must reserve what
 * is left for the chief, which is the one stage that must complete or the
 * council produces nothing at all. Otherwise the full roster runs, and pressure
 * that appears mid-run is handled where it appears — see `gatherReports`. */
function affordableRoster(carriesHubContext: boolean): number {
  const chain = chainStatus('zenith', carriesHubContext);
  const live = chain.filter((entry) => !entry.cooling).length;
  if (chain.length && live === 0) return 2;
  return SPECIALISTS.length;
}

/* ---------- reading what came back ---------- */

/* Models wrap JSON in prose and in code fences however firmly they are asked
   not to. The object is found rather than assumed to be the whole reply. */
export function extractJson(text: string): Record<string, unknown> | null {
  const source = String(text || '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(source);
  const candidate = fenced ? fenced[1]! : source;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface Plan {
  roster: string[];
  focus: Record<string, string>;
}

export function parsePlan(text: string, affordable: number): Plan | null {
  const parsed = extractJson(text);
  if (!parsed) return null;

  const roster = (Array.isArray(parsed.roster) ? parsed.roster : [])
    .map((id) => String(id).trim().toLowerCase())
    .filter((id) => BY_ID[id]);

  if (!roster.length) return null;

  const focus: Record<string, string> = {};
  if (parsed.focus && typeof parsed.focus === 'object') {
    for (const [id, brief] of Object.entries(parsed.focus as Record<string, unknown>)) {
      if (BY_ID[id] && typeof brief === 'string') focus[id] = brief.slice(0, 300);
    }
  }

  return { roster: [...new Set(roster)].slice(0, affordable), focus };
}

export function parseReview(text: string): string[] {
  const parsed = extractJson(text);
  const list = parsed && Array.isArray(parsed.corrections) ? parsed.corrections : [];
  return list
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 8)
    .map((entry) => entry.trim().slice(0, 300))
    .slice(0, 6);
}

/* The confidence line each specialist ends on, so the reader can see where the
 * desk stood without opening every report.
 *
 * READ LOOSELY, ON PURPOSE. The brief asks for one exact form and models write
 * it a dozen ways: bold around the label, a colon in a different place, the
 * word before the label rather than after. A parser insisting on exact phrasing
 * reports most of the desk as having no view — a parsing failure presented as a
 * desk that would not commit. */
export function readConfidence(text: string): 'low' | 'medium' | 'high' | null {
  const line = String(text || '')
    .split('\n')
    .reverse()
    .find((candidate) => /confidence/i.test(candidate));
  if (!line) return null;

  const match = /\b(low|medium|moderate|high)\b/i.exec(line);
  if (!match) return null;

  const level = match[1]!.toLowerCase();
  return level === 'moderate' ? 'medium' : (level as 'low' | 'medium' | 'high');
}

/* The confidence line is removed from the body before display, because it is
   rendered beside the heading instead. Removed by the whole line so a decorated
   label goes with it. */
export function withoutConfidence(text: string): string {
  return String(text || '')
    .split('\n')
    .filter((line) => !(/confidence/i.test(line) && /\b(low|medium|moderate|high)\b/i.test(line)))
    .join('\n')
    .trim();
}

/* ---------- the run ---------- */

/** Does this question want the council, when the caller left the mode on Auto? */
export function wantsCouncil(question: string): boolean {
  const text = question.toLowerCase();
  const asksForAView =
    /\b(recommend|advise|options?|what would you|which would you|should (they|we|i|he|she)|best (route|option|course)|strategy|approach)\b/.test(
      text
    );
  const asksForDepth = /\b(analys|analyz|full|thorough|detailed|breakdown|assess|review|compare)\b/.test(text);
  /* Several clauses joined by "and" is usually several questions wearing one
     question mark, which is exactly the shape a council answers better. */
  const multiPart = (text.match(/\band\b/g) ?? []).length >= 2 && text.length > 140;
  return asksForAView || asksForDepth || multiPart;
}

/** The slice of the dossier this specialist reads, selected against its own remit. */
function sliceFor(specialist: { reads: string }, question: string, sources: EvidenceSource[]): EvidenceSource[] {
  const lens = `${specialist.reads} ${question}`;

  const rescored = sources.map((source) => {
    const reading = selectReading(source.page, lens, 2_600);
    return {
      ...source,
      text: reading.text,
      contentScore: reading.chosen.reduce((total, entry) => total + entry.score, 0)
    };
  });

  /* Ordered by relevance to THIS remit, not by authority: a specialist is
     reading closely for one thing, and the page that carries it leads even when
     a more authoritative page mentions it only in passing. Authority still
     governs what the chief trusts when the reports disagree. */
  rescored.sort((a, b) => b.contentScore - a.contentScore);

  return fitToBudget(rescored, SPECIALIST_EVIDENCE_CHARS).kept;
}

export async function runCouncil(options: CouncilOptions): Promise<CouncilResult> {
  const { question, sources, carriesHubContext, signal } = options;
  const stage = options.onStage ?? (() => {});

  const affordable = affordableRoster(carriesHubContext);

  stage('planning', 'allocating the council');
  const plan = await conduct(question, sources, affordable, carriesHubContext, signal).catch(() => null);

  const roster = (plan?.roster.length ? plan.roster : DEFAULT_ROSTER)
    .filter((id) => BY_ID[id])
    .slice(0, affordable);

  /* A roster shorter than the full set because the CONDUCTOR chose fewer is not
     a trim and must not be reported as one — picking the specialists a question
     needs is the conductor's job, and announcing it as a shortfall would tell
     the reader something was missing when nothing was. Only an allowance-driven
     cut is a trim. */
  const cutForBudget = affordable < SPECIALISTS.length;

  const { reports, abandoned } = await gatherReports(
    roster,
    question,
    sources,
    plan,
    carriesHubContext,
    stage,
    signal
  );

  const notRun = [
    ...(cutForBudget ? roster.slice(affordable) : []),
    ...abandoned
  ].map((id) => BY_ID[id]!.title.toLowerCase());

  const trimmed =
    cutForBudget || abandoned.length
      ? `The model allowance would not cover the full council, so ${
          notRun.length ? `it ran without: ${notRun.join(', ')}` : 'part of it did not run'
        }.`
      : null;

  const written = reports.filter((report) => report.ok);
  if (!written.length) {
    throw new Error('No specialist could report on this. The model chain refused every request.');
  }

  stage('answering', `writing from ${written.length} specialist report(s)`);
  const composed = await compose(question, sources, reports, trimmed, carriesHubContext, options);

  stage('checking', 'checking the answer against the evidence');
  const corrections = await review(question, sources, reports, composed.text, carriesHubContext, signal).catch(
    () => [] as string[]
  );

  let answer = composed.text;

  if (corrections.length) {
    stage('checking', `${corrections.length} problem(s) found — revising`);
    const revised = await revise(
      question,
      sources,
      composed.text,
      corrections,
      trimmed,
      carriesHubContext,
      signal
    ).catch(() => null);
    if (revised) answer = revised;
  }

  /* The same guards the single-pass answer runs. A council answer is not
     exempt: an unsourced figure is the worst output this system can produce
     regardless of how many passes produced it. */
  const guarded = clean(
    answer,
    sources.map((source) => ({ label: source.label, text: source.text })),
    question
  );

  /* The trim is appended rather than requested in the brief.
     The brief does ask the chief to mention it, and on the run that first
     exercised this it simply did not — an instruction is advice, and a reader
     who is not told part of the desk went unheard has been misled about how
     much the answer rests on. Stating it in code makes it unconditional. */
  const finalAnswer = trimmed ? `${guarded.text}\n\n_${trimmed}_` : guarded.text;

  return {
    answer: finalAnswer,
    roster: roster.map((id) => ({ id, title: BY_ID[id]!.title })),
    reports: reports.map((report) => ({
      ...report,
      text: report.ok && report.text ? withoutConfidence(report.text) : null
    })),
    corrections,
    trimmed,
    unsupportedFigures: guarded.unsupportedFigures,
    provider: composed.provider,
    model: composed.model
  };
}

/* ---------- the conductor ---------- */

/* Chooses the roster and gives each member something to look for. Runs on the
   fast tier: it is a routing decision, not analysis, and spending the careful
   model on it would double the time to first output. */
async function conduct(
  question: string,
  sources: EvidenceSource[],
  affordable: number,
  carriesHubContext: boolean,
  signal?: AbortSignal
): Promise<Plan | null> {
  const catalogue = SPECIALISTS.map((specialist) => `- ${specialist.id}: ${specialist.title}`).join('\n');

  const result = await chat({
    tier: 'spark',
    carriesHubContext,
    temperature: 0.2,
    maxTokens: 320,
    signal,
    messages: [
      {
        role: 'system',
        content:
          'You allocate work on an immigration research desk. You do not analyse anything yourself.\n\n' +
          'Reply with JSON and nothing else, in this shape:\n' +
          '{"roster":["id","id"],"focus":{"id":"one sentence telling that specialist what to look for"}}\n\n' +
          `Pick at most ${affordable} specialists — the ones this particular question actually needs, most ` +
          'important first. Always include "risk" unless the question is purely a lookup of one figure.'
      },
      {
        role: 'user',
        content:
          `Question: ${question}\n\n` +
          `Sources available: ${sources.map((source) => `${source.label} (${source.authority})`).join('; ')}\n\n` +
          `Specialists:\n${catalogue}`
      }
    ]
  });

  return parsePlan(result.text, affordable);
}

/* ---------- the specialists ---------- */

async function gatherReports(
  roster: string[],
  question: string,
  sources: EvidenceSource[],
  plan: Plan | null,
  carriesHubContext: boolean,
  stage: (stage: string, detail?: string) => void,
  signal?: AbortSignal
): Promise<{ reports: CouncilReport[]; abandoned: string[] }> {
  const out: CouncilReport[] = [];

  for (let index = 0; index < roster.length; index += WAVE) {
    const wave = roster.slice(index, index + WAVE);
    stage('council', wave.map((id) => BY_ID[id]!.step).join(' · '));

    const written = await Promise.all(
      wave.map((id) => oneReport(id, question, sources, plan, carriesHubContext, signal))
    );
    out.push(...written);

    /* Stop when the allowance is spent rather than walking the rest of the
     * roster into the same wall.
     *
     * A whole wave failing is the signal — one specialist failing is a bad
     * request or an empty completion, which says nothing about the allowance,
     * while three failing together is the chain refusing. Continuing would
     * spend the remaining requests on certain failures and leave nothing for
     * the chief, so the rest of the roster is abandoned and REPORTED. */
    const waveFailed = written.every((report) => !report.ok);
    const remaining = roster.slice(index + WAVE);

    if (waveFailed && written.length > 1 && remaining.length) {
      stage('council', `chain refused — ${remaining.length} specialist(s) not run`);
      return { reports: out, abandoned: remaining };
    }
  }

  return { reports: out, abandoned: [] };
}

async function oneReport(
  id: string,
  question: string,
  sources: EvidenceSource[],
  plan: Plan | null,
  carriesHubContext: boolean,
  signal?: AbortSignal
): Promise<CouncilReport> {
  const specialist = BY_ID[id]!;
  const focus = plan?.focus[id];
  const slice = sliceFor(specialist, question, sources);
  const wrapped = wrapUntrusted(slice);

  try {
    const result = await chat({
      tier: 'zenith',
      carriesHubContext,
      temperature: 0.3,
      maxTokens: 560,
      signal,
      messages: [
        {
          role: 'system',
          content: [
            `You are the ${specialist.title.toLowerCase()} specialist on an immigration research desk.`,
            '',
            specialist.remit,
            '',
            'HOW YOU REPORT.',
            '- Under 200 words. You are one voice of several and the desk lead reads all of them.',
            '- Every figure and rule you state must appear in the evidence below. You have no other source ' +
              'and no memory of these rules. If something you need is not there, say it is not there — that ' +
              'is a finding, and a supplied figure would be a fabrication.',
            '- Cite as [Source: <label>] immediately after the claim it supports.',
            '- End with exactly one line: "CONFIDENCE: low|medium|high" and one clause saying what would ' +
              'change it.',
            '- No preamble, no restating the question, no disclaimer.',
            '',
            untrustedContentRules(wrapped.nonce)
          ].join('\n')
        },
        {
          role: 'user',
          content:
            `${wrapped.text}\n\n` +
            `THE QUESTION BEING ANSWERED BY THE DESK: ${question}\n` +
            (focus ? `YOUR BRIEF: ${focus}\n` : '')
        }
      ]
    });

    const text = result.text.trim();
    if (!text) return { id, title: specialist.title, ok: false, text: null, confidence: null, reason: 'wrote nothing' };

    return { id, title: specialist.title, ok: true, text, confidence: readConfidence(text), reason: null };
  } catch (error) {
    return {
      id,
      title: specialist.title,
      ok: false,
      text: null,
      confidence: null,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

/* ---------- the chief ---------- */

/* THE BRIEF THAT DECIDES WHETHER THIS IS USEFUL.
 *
 * The single-pass answer already commits to a recommendation, and this must
 * too. An assistant that reads every rule and will not say what it makes of
 * them is useless to a consultant who has to act. The discipline that replaces
 * a refusal to conclude is stricter than the refusal was: a position is only
 * worth anything when it names the fact that would overturn it.
 *
 * What this is NOT is advice to a client. It is research for a qualified
 * consultant to review — which is why it can reason freely, and why every
 * answer carries that framing. */
function chiefBrief(trimmed: string | null, nonce: string): string {
  return [
    'You are the lead of an immigration research desk. Your reader is a qualified the organisation consultant who will ' +
      'review what you write before any of it reaches a client. You are not writing to the client and you ' +
      'are not a compliance department.',
    '',
    'YOU REACH A CONCLUSION. When asked what the options are and which to take, answer it: which route, ' +
      'what has to be true, and what you would do. "It depends on the circumstances" is not an answer. If ' +
      'the honest conclusion is that nothing works on these facts, say that plainly — that is a conclusion ' +
      'too, and often the right one.',
    '',
    'THE DISCIPLINE THAT MAKES A CONCLUSION WORTH READING:',
    '- Every figure and rule comes from the desk reports and the evidence below. You have no memory of ' +
      'these rules and no other source. A figure you cannot point at is a figure you do not use.',
    '- Every figure carries its effective date. Immigration rules change constantly and an undated figure ' +
      'is not usable by the person acting on it.',
    '- Name what would change the answer. If you cannot say what fact would overturn it, you do not have a ' +
      'conclusion, you have an impression.',
    '- Give the case against properly, in its own right, not as a closing disclaimer.',
    '- Where the specialists disagreed, say so, say which you came down on, and why. Disagreement between ' +
      'the rule and the commentary is information, not noise to be averaged away.',
    '- Where a specialist reported that something was NOT in the evidence, carry that forward as an open ' +
      'question. Do not quietly fill the gap.',
    '- An official source beats a lower-tier one stating something different. Do not average them.',
    trimmed
      ? '- PART OF THE DESK DID NOT RUN. Say so in one line at the end, naming what was not covered: ' +
        trimmed
      : '',
    '',
    'HOW IT READS: markdown. Lead with the direct answer — the figure, the date, the yes or no — never ' +
      'buried under preamble. Then the reasoning, structured to the question. Then what could change it. ' +
      'Bold the figures and dates so they can be found without reading. British spelling. No preamble, no ' +
      '"great question", no summary of what you are about to say.',
    '',
    untrustedContentRules(nonce)
  ]
    .filter(Boolean)
    .join('\n');
}

async function compose(
  question: string,
  sources: EvidenceSource[],
  reports: CouncilReport[],
  trimmed: string | null,
  carriesHubContext: boolean,
  options: CouncilOptions
): Promise<{ text: string; provider: string; model: string }> {
  const written = reports.filter((report) => report.ok);
  const failed = reports.filter((report) => !report.ok);

  const body = written.map((report) => `### ${report.title}\n${report.text}`).join('\n\n');
  const failedNote = failed.length
    ? `\n\nThese specialists could not report: ${failed
        .map((report) => `${report.title} (${report.reason})`)
        .join(', ')}`
    : '';

  /* The reports are paid first; the raw evidence takes what is left. */
  const evidenceRoom = CHIEF_PROMPT_CHARS - body.length - failedNote.length - question.length;

  const attempt = async (
    evidenceChars: number,
    onToken: CouncilOptions['onToken']
  ): Promise<{ text: string; provider: string; model: string }> => {
    const kept = evidenceChars >= MIN_USEFUL_EVIDENCE ? fitToBudget(sources, evidenceChars).kept : [];
    const wrapped = wrapUntrusted(kept);

    const result = await chat({
      tier: 'zenith',
      carriesHubContext,
      temperature: 0.4,
      /* Room to reason AND to write. A model that thinks in the completion spent
         a 2,200 ceiling narrating and left the note truncated mid-sentence. */
      maxTokens: 3200,
      signal: options.signal,
      onToken,
      messages: [
        { role: 'system', content: chiefBrief(trimmed, wrapped.nonce) },
        {
          role: 'user',
          content:
            `THE QUESTION: ${question}\n\n` +
            `YOUR DESK REPORTED:\n\n${body}` +
            failedNote +
            (kept.length ? `\n\nTHE UNDERLYING EVIDENCE:\n${wrapped.text}` : '')
        }
      ]
    });

    const text = result.text.trim();
    if (!text) throw new Error('The chief returned nothing.');
    return { text, provider: result.provider, model: result.model };
  };

  try {
    return await attempt(evidenceRoom, options.onToken);
  } catch (error) {
    if (error instanceof StoppedError) throw error;

    /* THE CHIEF IS THE ONE STAGE THAT MUST PRODUCE SOMETHING.
     *
     * Six specialist calls have already been spent by this point. Failing here
     * throws all of that away and returns nothing, which is the worst possible
     * outcome and exactly what happened on the run that prompted this: the
     * prompt was large enough that the model answered with an empty completion.
     *
     * So a failure retries on the reports alone. They are a summary of the
     * evidence written by passes that read it closely, so the answer is
     * shallower but still grounded — depth degrades, availability does not.
     * Streaming is dropped on the retry because the first attempt may already
     * have emitted a partial answer to the caller. */
    options.onStage?.('answering', 'retrying the summary on the reports alone');
    return attempt(0, undefined);
  }
}

/* ---------- the reviewer ---------- */

/* Checks the written answer against the evidence rather than against taste.
   Three failures matter and nothing else does: a figure that was invented, a
   claim the evidence contradicts, and a question that was not answered. */
async function review(
  question: string,
  sources: EvidenceSource[],
  reports: CouncilReport[],
  answer: string,
  carriesHubContext: boolean,
  signal?: AbortSignal
): Promise<string[]> {
  const wrapped = wrapUntrusted(fitToBudget(sources, REVIEW_EVIDENCE_CHARS).kept);

  const result = await chat({
    tier: 'zenith',
    carriesHubContext,
    temperature: 0.1,
    maxTokens: 460,
    signal,
    messages: [
      {
        role: 'system',
        content:
          'You check a written immigration research note against the evidence it was written from. You are ' +
          'not an editor: style, length and tone are none of your business.\n\n' +
          'Look for exactly three things.\n' +
          '1. A FIGURE OR RULE IN THE NOTE THAT IS NOT IN THE EVIDENCE. Arithmetic on two figures that are ' +
          'both there is fine; a threshold, fee or time limit that appeared from nowhere is not, and is the ' +
          'most serious defect you can find.\n' +
          '2. A CLAIM THE EVIDENCE CONTRADICTS, including a superseded rule stated as current.\n' +
          '3. THE QUESTION NOT ACTUALLY ANSWERED. If it asked which option to take and no option is ' +
          'chosen, that is a failure.\n\n' +
          'Reply with JSON and nothing else: {"corrections":["one sentence each"]}. An empty list is the ' +
          'expected answer and you must not invent work.\n\n' +
          untrustedContentRules(wrapped.nonce)
      },
      {
        role: 'user',
        content:
          `THE QUESTION: ${question}\n\n` +
          `THE EVIDENCE:\n${wrapped.text}\n\n` +
          `THE DESK REPORTS:\n${reports
            .filter((report) => report.ok)
            .map((report) => `${report.title}: ${report.text}`)
            .join('\n\n')}\n\n` +
          `THE NOTE:\n${answer}`
      }
    ]
  });

  return parseReview(result.text);
}

async function revise(
  question: string,
  sources: EvidenceSource[],
  answer: string,
  corrections: string[],
  trimmed: string | null,
  carriesHubContext: boolean,
  signal?: AbortSignal
): Promise<string | null> {
  const wrapped = wrapUntrusted(fitToBudget(sources, REVIEW_EVIDENCE_CHARS).kept);

  const result = await chat({
    tier: 'zenith',
    carriesHubContext,
    temperature: 0.3,
    /* Room to reason AND to write. A model that thinks in the completion spent
       a 2,200 ceiling narrating and left the note truncated mid-sentence. */
    maxTokens: 3200,
    signal,
    messages: [
      { role: 'system', content: chiefBrief(trimmed, wrapped.nonce) },
      { role: 'user', content: `THE QUESTION: ${question}\n\nTHE EVIDENCE:\n${wrapped.text}` },
      { role: 'assistant', content: answer },
      {
        role: 'user',
        content:
          'A check against the evidence found these problems:\n' +
          corrections.map((correction) => `- ${correction}`).join('\n') +
          '\n\nRewrite the note with each of them fixed. Keep everything that was not a problem, including ' +
          'the conclusion and the figures that were supported. Do not add a note about having revised it.'
      }
    ]
  });

  const revised = result.text.trim();
  /* A revision that came back shorter than a paragraph is a failed revision,
     not a tightened one. The original stands. */
  return revised.length > 200 ? revised : null;
}
