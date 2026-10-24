/* Deciding what a turn actually needs.
 *
 * The old split was binary: small talk, or research. Everything that was not a
 * recognised greeting went to the web. That is why "hi" once searched GOV.UK,
 * and it is also why worse things happened quietly — "who's on my team" was
 * answered from the internet, and a logic puzzle was answered from the
 * internet, because retrieval was the only thing the pipeline knew how to do.
 *
 * A question does not have two shapes here, it has seven:
 *
 *   chat      small talk. No tools, no sources, one or two sentences.
 *   self      about the assistant, the Hub, or the organisation itself.
 *   hub       about records this Hub holds — tasks, calendar, clients, people.
 *   action    a request to change something. Becomes a proposal, never a write.
 *   draft     an email or message to write. Produced as a draft, never sent.
 *   reason    a problem to think through. Logic, arithmetic, a judgement call
 *             with the facts already supplied. Searching this is worse than
 *             useless: it fills the context with pages about nothing and
 *             invites the model to answer from them instead of thinking.
 *   research  a question about the world, answered from sources.
 *
 * TWO STAGES, AND THE ORDER IS THE POINT. Obvious turns are settled in code —
 * a greeting must not cost a model round trip to recognise. Everything else
 * goes to one fast structured call that names the route AND supplies what that
 * route needs, so routing a research question also plans its searches and
 * routing a Hub question also says which records to read. One call, not three.
 *
 * WHEN IN DOUBT, RESEARCH. A reasoning question misrouted to research wastes
 * ten seconds. A research question misrouted to reasoning produces a confident,
 * sourceless answer about somebody's immigration status, and looks identical to
 * a good one.
 */

import { chat, StoppedError } from '../gateway/client';

export type Route = 'chat' | 'self' | 'hub' | 'action' | 'reason' | 'research' | 'draft';

/** Which Hub reads a turn needs. Named, not free-form — the broker has a fixed set. */
export type HubRead = 'team' | 'tasks' | 'calendar' | 'clients' | 'projects' | 'standing';

export interface RoutePlan {
  route: Route;
  /** Research only: the searches to run. Already de-identified by the planner's rules. */
  queries: string[];
  /** Hub only: which records to read, and an optional name to filter on. */
  reads: HubRead[];
  search?: string;
  /** Hub/self only: whether the question is about the caller's own work. */
  mineOnly?: boolean;
  /** Self only: whether answering needs what the company publishes about itself. */
  needsCompany?: boolean;
  /** Action only: the proposal to put in front of the user. */
  action?: { kind: string; params: Record<string, unknown>; reason: string };
  /** How the route was chosen. Shown in the thinking panel — a silent route is a debugging trap. */
  via: 'rule' | 'model' | 'fallback';
}

/* ---------- stage one: what code can settle on its own ---------- */

const GREETING =
  /^(hi|hii+|hey+|hello+|yo|sup|hiya|howdy|good (morning|afternoon|evening)|morning|afternoon|evening|greetings)$/i;

const PLEASANTRY =
  /^(thanks?|thank you|ta|cheers|nice one|great|perfect|ok|okay|k|cool|got it|understood|no worries|np|bye|goodbye|see ya|later|night|lol|haha)[!.]*$/i;

const HOW_ARE_YOU = /^(how are you( doing)?|you (ok|okay|alright|good)|hows it going|how's it going|whats up|what's up)[?!.]*$/i;

/* Questions about the assistant, the app, or the business.
 *
 * Broader than the old list and deliberately so — this is the category the
 * assistant used to answer from GOV.UK, which is the single most embarrassing
 * failure it had. "What can you do" should never involve a search engine. */
const ABOUT_SELF =
  /\b(who are you|what are you|what can you do|what do you do|how do you work|what is this|what'?s this|are you (an ai|a bot|real|chatgpt)|who (made|built|created) you|who do you work for|what (are you )?(powered|running) (by|on)|what model|do you (store|save|keep|remember)|is this (private|confidential|stored)|what is (forma|syrix forma|this app|syrix)|what does forma do|tell me about (forma|this app|yourself|the company)|what (is|does) (the )?(hub|app) (do|for)|your (limits|limitations|capabilities))\b/i;

/* Records this Hub holds. Anchored on possessives and Hub nouns together —
   "my tasks" is a Hub read, "task force visa" is not. */
/* "MY CLIENT" IS NOT A HUB RECORD, and this cost a correct answer.
 *
 * `clients?` and `cases?` used to be in this list, which meant "my client has
 * been here 9 years with 210 days absent — how many days can she be absent and
 * still qualify?" routed to a database read of the Clients table. It is the
 * single most natural way a consultant opens an immigration question, and the
 * answer would have been a list of client rows.
 *
 * The words are ambiguous and the readings are not equally likely: "my client"
 * almost always means the person whose case they are working on, not the record
 * in the Hub. A genuine question about the Hub's client list says so — "how
 * many clients do we have", "which clients am I on" — and HUB_NOUN below
 * catches those explicitly. */
const HUB_SUBJECT =
  /\b(my|our|the team'?s|this week'?s|today'?s|tomorrow'?s)\s+(tasks?|to.?dos?|work|workload|deadlines?|calendar|schedule|diary|meetings?|events?|projects?)\b/i;

/* The explicit ways somebody asks about the Hub's own records. Client and
   project questions live here rather than in HUB_SUBJECT above, because they
   have to be asked PLURALLY or by name to count — "which clients am I on" is
   about the Hub, "my client is worried about her absences" is not. */
const HUB_NOUN =
  /\b(who (works here|is on (my|the) team|else is on)|team members?|colleagues?|staff (list|directory)|whos on|who'?s on|what'?s (on|in) (my|the) (calendar|diary|schedule)|what am i (working on|doing)|am i free|what'?s due|what'?s overdue|how many (tasks?|clients?|projects?)|which (clients?|projects?) (am i|do i|are we)|list (my|our|the) (clients?|projects?|tasks?)|(my|our) (clients|projects) )/i;

/* An instruction to change something, rather than a question about it. Leading
   verb only: "add a task" is an action, "how do I add a task" is a question
   about the Hub and gets an answer, not a card. */
const ACTION_VERB =
  /^(add|create|make|set|schedule|book|put|log|note|remind|assign)\b(?!.*\b(how|what|why|when|where|can i|do i)\b)/i;

/* If any of these appear, it is a real research question no matter how it
   opens. Conservative on purpose — see the note at the top about which
   direction the mistakes should fall. */
export const DOMAIN_TERM =
  /\b(visa|immigration|ilr|settle|settlement|leave to remain|residence|sponsor(?:s|ship|ing)?|certificate of sponsorship|salary|threshold|fee|refus|appeal|deport|asylum|citizen|naturalis|passport|nationality|spouse|dependant|dependent|graduate|student|skilled worker|home office|gov\.?uk|immigration rules?|biometric|brp|evisa|share code|right to work|right to rent)\b/i;

/* "help" on its own is somebody asking what this thing does. "help with a
   spouse visa" is not, and the domain check above catches it — but so would a
   dozen other unanchored forms, so this one is matched whole or not at all. */
const BARE_HELP = /^(help|help me|what now|what next|options)$/i;

/* ARITHMETIC THE QUESTION CARRIES ITS OWN NUMBERS FOR.
 *
 * The model router would not stop sending these to the web. Asked to work out
 * how many extra billable hours a 25% fee-income target needs, it chose
 * research three times running — "fee", "income" and "UK" are enough to look
 * like a question about the outside world — and the pipeline attached "Visit
 * the UK as a Standard Visitor" and "Graduate visa" as the sources for a
 * multiplication. Sharpening the prompt did not fix it, and two post-hoc
 * relevance guards did not catch it either: search returns real official pages
 * that share ordinary words like "fee" and "hours" with the question.
 *
 * So it is decided in code. The test is narrow and safe in the direction that
 * matters: it fires only when the question has NO domain term at all, so
 * nothing about immigration can reach it — and when it does fire, the facts are
 * demonstrably in the question, because it is full of numbers.
 *
 * Two signals together, never either alone. "How many days can she be absent"
 * is a question about a rule and has a domain term, so it never gets here.
 * "What is 7 times 46" has numbers and an instruction to compute. */
/* No trailing `\b`. The stems here are prefixes — "calculat" has to match
   "calculate", "calculation" and "calculating" — and a word boundary after a
   stem requires the word to END there, so `\bcalculat\b` matches nothing a
   person would ever type. Caught by a test that expected "want to calculate the
   cost" to be arithmetic and got a web search. */
const COMPUTE_INSTRUCTION =
  /\b(work (it |this )?out|calculat|comput|how many|how much|what would.{0,20}(be|come to)|figure out|add up|per ?cent|%|utilisation|utilization|break.?even|forecast|projection|budget|margin|ratio)/i;

/* A WIDER NET, USED ONLY TO VETO.
 *
 * `DOMAIN_TERM` is kept narrow because it also decides whether a turn may be
 * routed to the Hub or to an action, and a broad list there would hijack "add a
 * task about the client meeting". This list has the opposite job: it stops the
 * arithmetic rule and the reasoning fallback from claiming a question that
 * turns on a published rule, and being over-broad costs nothing — the question
 * merely goes to research and gets sources it did not strictly need.
 *
 * The failure that produced it: "my client has been here 9 years and 3 months
 * with 210 days absent — how many days can she be absent and still qualify?"
 * has "how many" and four quantities, and none of the narrow list's words. It
 * was about to be answered from memory. An absence limit is exactly the sort of
 * number a model remembers confidently and wrongly. */
/* The words that can only mean immigration.
 *
 * `DOMAIN_TERM` includes money words — "fee", "salary", "threshold" — because a
 * question about a visa fee has to reach research even when it names no route.
 * But those words are not exclusively about immigration, and "grow FEE income
 * by 25%" tripped it: a question about the firm's own revenue was treated as a
 * question about Home Office charges, and it beat the arithmetic rule to the
 * decision because the domain check runs first.
 *
 * This list has no such words in it. Everything here names a route, a status, a
 * document or a body, and none of it appears in a sentence about billable
 * hours. It is used only to hold the arithmetic rule back. */
const STRONG_DOMAIN =
  /\b(visa|immigration|ilr|leave to remain|settlement|settled status|sponsor(?:s|ship|ing)?|certificate of sponsorship|asylum|refugee|deport|citizen|naturalis|passport|nationality|spouse|partner visa|dependant|dependent|graduate route|student route|skilled worker|home office|gov\.?uk|biometric|brp|evisa|share code|right to work|right to rent|refus|appeal|tribunal|caseworker)\b/i;

const LEGAL_SUBJECT =
  /\b(absen|qualif|eligib|continuous|lawful|entitle|allow|permit|rule|regulation|law|legal|statut|requirement|criteri|application|applicant|apply|applie|refus|grant|extend|extension|switch|route|status|remain|reside|resident|british|home office|caseworker|tribunal|court|solicitor|barrister|deadline|expir|renew|overstay|breach|condition)/i;

/* ANALYSIS OF A SITUATION THE QUESTION ITSELF DESCRIBES.
 *
 * The failure: "a UK company wants to deploy an AI system that handles customer
 * support, processes personal data and makes recommendations about financial
 * products — identify the major technical, privacy, cybersecurity, regulatory
 * and ethical risks, rank them, and explain how you would mitigate each one."
 * That was routed to research, which searched, returned a family-visa page and
 * an article about customer-relationship management, and then declined to
 * answer because its sources said nothing about the risks. Forty-eight seconds
 * to produce nothing, on a question whose entire content is professional
 * judgement about a scenario the asker had just spelled out.
 *
 * The signal is not the subject, it is the shape: an instruction to identify,
 * rank, weigh or evaluate, applied to something the question has already
 * described in full. No published page contains this company's situation, which
 * is the same test that separates reasoning from research everywhere else.
 *
 * THREE GUARDS, and they are what make this safe. Nothing that names a route, a
 * status or a document reaches it. Nothing phrased around what is allowed,
 * required or permitted reaches it. And the question has to be long enough to
 * have set out a scenario — "what are the penalties" is short, is about a
 * published figure, and belongs on the web.
 *
 * Like the arithmetic rule above, this sits before the domain net rather than
 * after it, so that a question about the firm's own commercial risks is not
 * claimed by a money word that also appears in Home Office fee guidance. */
const ANALYTICAL_INSTRUCTION =
  /\b(identify|rank|prioriti[sz]e|weigh up|compare and contrast|evaluate|assess|appraise|outline|draw up|set out|what would you do|how would you|pros and cons|trade-?offs?|strengths and weaknesses)\b/i;

const ANALYTICAL_OBJECT =
  /\b(risks?|options?|approach(?:es)?|trade-?offs?|strateg(?:y|ies)|pros|cons|considerations?|factors?|priorities|mitigations?|controls?|drawbacks?|downsides?|benefits?)\b/i;

/* A scenario takes words to describe. Below this, the question is a lookup
   wearing an analytical verb. */
const ANALYTICAL_MIN_CHARS = 120;

/* A REQUEST FOR CODE IS NOT A REQUEST TO GO AND READ ABOUT CODE.
 *
 * "Give me the Python to read a CSV and print the first five rows" was routed to
 * research. It searched, read two Wikipedia articles — "Polars (software)" and
 * "Muse (headband)" — and cited both under three lines of pandas. The code was
 * correct and the citations were absurd, which is the combination this pipeline
 * keeps producing whenever something with no page behind it reaches the research
 * path: no published page contains the snippet somebody wants, and a model given
 * irrelevant sources under an instruction to answer from them will use them.
 *
 * GUARDED AGAINST THE DOMAIN, and specifically against the word "code". A share
 * code, an occupation code and a sponsor licence number are all "codes" in this
 * business, and every one of those questions turns on a published rule. Anything
 * the domain nets touch never reaches this rule. */
const CODE_LANGUAGE =
  /\b(python|javascript|typescript|java|c\+\+|c#|golang|rust|php|ruby|sql|bash|shell|powershell|regex|regular expression|html|css|json|yaml|xml|docker|kubernetes|git|excel formula|vba|pandas|numpy|react|node\.?js|api call|curl)\b/i;

const CODE_NOUN = /\b(code|script|snippet|function|one-?liner|command|query|program|algorithm)\b/i;

const CODE_VERB =
  /\b(write|give me|show me|generate|create|make|produce|how (do|would) i (write|code|do)|help me (write|code))\b/i;

/* WRITING SOMETHING TO SEND, RATHER THAN ANSWERING A QUESTION.
 *
 * Both halves are required, and the object list is short on purpose. "Write a
 * report on this refusal" is not a message to somebody — it is a piece of work
 * with a different shape — and "add a note to the client record" is an action on
 * a Hub record however much it sounds like writing.
 *
 * This rule is checked BEFORE the domain net, unlike everything else below it.
 * "Draft an email to the client about their ILR application" carries a domain
 * term and would otherwise return early and be researched, which produces a page
 * of guidance where somebody asked for a message they could send. The rule is
 * kept honest at the other end instead: a draft that turns on a published figure
 * is written from retrieved sources, and anything not in them is left as a
 * marked gap rather than filled in from memory — see `answerByDrafting`. */
const DRAFT_VERB =
  /\b(draft|write|compose|redraft|rewrite|re-?word|reword|tidy up|shorten|polish|reply to|respond to|get back to)\b/i;
const DRAFT_OBJECT = /\b(e-?mails?|messages?|letters?|notes? to|repl(?:y|ies)|responses?|memos?)\b/i;
/* A question about how to write one is a question, not a request for one. */
const DRAFT_QUESTION = /\b(how (do|would|should) i|how to|what should i|is it (ok|okay|acceptable))\b/i;

/* At least two distinct quantities. One number is a reference ("section 3");
   several are the inputs to a sum. */
function countsQuantities(text: string): number {
  return (text.match(/\b\d[\d,]*(?:\.\d+)?\s*(?:%|hours?|hrs?|days?|weeks?|months?|years?|people|staff|k\b|m\b)?/gi) ?? [])
    .length;
}

export function ruleRoute(question: string): Route | null {
  const text = question.trim().replace(/\s+/g, ' ');
  const bare = text.replace(/[.!?]+$/, '');

  /* ARITHMETIC IS CHECKED BEFORE THE DOMAIN NET, NOT AFTER.
   *
   * It has to be. `DOMAIN_TERM` contains money words so that "what's the ILR
   * fee" reaches research without naming a route — and "grow FEE income by 25%"
   * matches the same word. Running the domain check first meant a question
   * about the firm's own revenue returned early and went to the web, which is
   * how a billable-hours sum ended up citing "Visit the UK as a Standard
   * Visitor".
   *
   * Safe here because this rule carries its own, stricter guards: no word that
   * can only mean immigration, no phrasing about what is allowed or required,
   * and at least three quantities to combine. A question that passes all three
   * has its facts in it. */
  if (
    COMPUTE_INSTRUCTION.test(text) &&
    !STRONG_DOMAIN.test(text) &&
    !LEGAL_SUBJECT.test(text) &&
    countsQuantities(text) >= 3
  ) {
    return 'reason';
  }

  if (
    text.length >= ANALYTICAL_MIN_CHARS &&
    ANALYTICAL_INSTRUCTION.test(text) &&
    ANALYTICAL_OBJECT.test(text) &&
    !STRONG_DOMAIN.test(text) &&
    !LEGAL_SUBJECT.test(text)
  ) {
    return 'reason';
  }

  if (
    !DOMAIN_TERM.test(text) &&
    !STRONG_DOMAIN.test(text) &&
    CODE_VERB.test(text) &&
    (CODE_LANGUAGE.test(text) || CODE_NOUN.test(text))
  ) {
    return 'reason';
  }

  if (DRAFT_VERB.test(text) && DRAFT_OBJECT.test(text) && !DRAFT_QUESTION.test(text)) return 'draft';

  /* A domain term beats every conversational rule below it. "hi, what's the
     ILR fee" opens like a greeting and is not one. */
  if (DOMAIN_TERM.test(text)) return null;

  if (GREETING.test(bare)) return 'chat';
  if (PLEASANTRY.test(bare)) return 'chat';
  if (HOW_ARE_YOU.test(bare)) return 'chat';
  if (BARE_HELP.test(bare)) return 'self';

  /* Length is a guard, not a signal: a long message mentioning "what can you
     do" in passing is a real question with context attached, and answering it
     from the identity block alone would ignore everything else in it. */
  if (text.length < 160 && ABOUT_SELF.test(text)) return 'self';
  if (text.length < 160 && (HUB_SUBJECT.test(text) || HUB_NOUN.test(text))) return 'hub';
  if (text.length < 300 && ACTION_VERB.test(text)) return 'action';

  return null;
}

/**
 * A QUESTION ABOUT IMMIGRATION IS NEVER JUST A THINKING EXERCISE.
 *
 * Observed, and the reason this override exists: "a client has been here four
 * years on a Skilled Worker visa, stay on it to ILR or switch to Global Talent
 * — what would you do?" routed to "reason", because it is phrased as a request
 * for a view. The answer was committed and well argued, and it stated the
 * qualifying periods for two settlement routes with no source behind any of
 * them and nothing marking them unverified. That is the most dangerous output
 * this system can produce, and it looked like its best one.
 *
 * The phrasing is not the signal — the subject is. Asking for a view does not
 * stop a question turning on a published rule, and the research path already
 * knows how to reach a view, so nothing is lost by sending it there. Reasoning
 * stays available for everything the domain terms do not touch: logic,
 * arithmetic, sequencing, and weighing options whose facts are all already in
 * the question.
 */
export function groundIfDomain(route: Route, question: string): Route {
  if (route !== 'reason') return route;
  /* Both nets: the narrow one catches a named route or fee, the wide one
     catches "is she allowed", "does he qualify", "what's the deadline" — the
     phrasings that turn on a rule without naming one. */
  return DOMAIN_TERM.test(question) || LEGAL_SUBJECT.test(question) ? 'research' : route;
}

/* ---------- stage two: the structured call ---------- */

const ROUTER_SYSTEM = `You route a question for an assistant used by staff at a UK immigration consultancy called the organisation. Their internal application is called SYRIX Forma.

Answer with ONE JSON object and nothing else. No explanation, no markdown fence, no text before or after.

{"route": "...", "queries": [], "reads": [], "search": "", "mineOnly": false, "needsCompany": false}

Choose exactly one route:

- "chat" — small talk. A greeting, thanks, or anything with no question in it.
- "self" — about the assistant itself, about SYRIX Forma the application, or about the organisation the company. Set "needsCompany": true when it asks what the business does, what services it offers, or where it is based.
- "hub" — about records inside SYRIX Forma: this person's tasks, the calendar, clients, projects, or who works there. Fill "reads" with any of: team, tasks, calendar, clients, projects, standing. Set "mineOnly": true when they said "my" or "I". Put a name to filter on in "search" if they named a client, project or person.
- "action" — an instruction to create or change something in SYRIX Forma.
- "draft" — a request to write an email, message, letter or reply for them to send. Fill "queries" as well if the message turns on a rule, fee or deadline, so it can be written from sources rather than from memory.
- "reason" — a problem to think through rather than look up. Logic puzzles, arithmetic, planning a sequence of steps, weighing options where the facts are already in the question, or "what would you do". Nothing on a web page would help.
- "research" — a question about the outside world: law, rules, fees, deadlines, procedures, news, anything that changes over time or that you would need to check. Fill "queries" with 1 to 4 web search queries.

THE TEST THAT SEPARATES "reason" FROM "research": could you name a specific page that would settle this? If the numbers and constraints are all stated in the question and the work is to combine them, it is "reason" — no page contains this person's own figures. Business arithmetic, capacity and utilisation sums, pricing and revenue targets, rotas and scheduling, and "how many do we need" questions are "reason" even when they mention money, fees, hours or the UK. A question is only "research" if the answer lives on a page somebody published.

Rules for "queries":
- ALWAYS fill "queries" if the question touches immigration, law, fees, deadlines or official procedure — even when you chose "reason". Something downstream may still need to search, and a route with no queries has to fall back to a much worse one built by stripping words out of the question.
- IF THE QUESTION COMPARES TWO OR MORE THINGS, WRITE ONE QUERY PER THING, each naming only that one. A single query mentioning both finds pages about the better-known one and nothing about the other, and the answer then says the second could not be established — which is a retrieval failure wearing the words of an honest caveat.
- Keywords, not sentences. Include "UK" and the route or rule name where you can.
- Use the publisher's vocabulary: government pages say "minimum salary", not "salary threshold"; "indefinite leave to remain", not "ILR".
- NEVER include a person's name, case reference, passport number, date of birth, address, email or phone number. Describe the situation generically.
- Include the current year — the one given to you below, not one you remember — for anything time-sensitive. Fees and salary thresholds change every year, so a query carrying a stale year finds the wrong figure and looks like it worked.
- The person may have typed quickly. Read past their typos to what they meant and spell the terms correctly in the query: a misspelled query matches nothing and returns whatever the engine falls back to.

If you are unsure between "reason" and "research", choose "research".`;

/* Models asked for JSON return JSON most of the time. The rest of the time they
   return JSON wrapped in a fence, or preceded by a sentence explaining that
   they are about to return JSON. Both are recoverable and neither is worth
   failing a turn over — so the first balanced object in the text is taken. */
function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const character = text[index]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (character === '{') depth++;
    else if (character === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

const ROUTES: Route[] = ['chat', 'self', 'hub', 'action', 'reason', 'research', 'draft'];
const READS: HubRead[] = ['team', 'tasks', 'calendar', 'clients', 'projects', 'standing'];

/* A query is short, has no sentence punctuation, and is not written in the
   first person. Shape is a far better filter than trying to enumerate the
   phrases a model narrates with, because there is always another phrase. */
function looksLikeQuery(line: string): boolean {
  if (line.length < 6 || line.length > 120) return false;
  if (line.split(/\s+/).length > 14) return false;
  if (/[.:;?!"]/.test(line)) return false;
  return !/\b(?:we|i|let's|lets|should|must|need to|provide|output|queries|so)\b/i.test(line);
}

/**
 * Route one turn.
 *
 * NEVER THROWS except on a deliberate stop. Routing is a decision about which
 * good path to take, and every path is better than an error message — a router
 * failure degrades to research, which is what the pipeline did for every
 * question before this file existed.
 */
export async function planRoute(
  question: string,
  options: { signal?: AbortSignal; carriesHubContext?: boolean } = {}
): Promise<RoutePlan> {
  const settled = ruleRoute(question);
  if (settled) {
    return {
      route: settled,
      /* A DRAFT ABOUT A RULE STILL NEEDS THE RULE.
       *
       * Every other rule-settled route answers without retrieval, so an empty
       * query list was right for all of them — and wrong the moment drafting
       * joined them. "Draft an email telling the client their ILR application
       * is in" is settled here in code, arrived at `answerByDrafting` with
       * nothing to search, and the processing time in the resulting email came
       * from the model's memory. The queries are built the same way the
       * fallback path builds them, from the rule's own name and the question's
       * keywords. */
      queries:
        settled === 'draft' && (DOMAIN_TERM.test(question) || LEGAL_SUBJECT.test(question))
          ? [rulePhraseQuery(question), keywordQuery(question)].filter(Boolean)
          : [],
      reads: settled === 'hub' ? defaultReads(question) : [],
      mineOnly: /\b(my|i|me|mine)\b/i.test(question),
      needsCompany: settled === 'self' && /\b(company|business|firm|we do|services|clients|based|office)\b/i.test(question),
      via: 'rule'
    };
  }

  let text: string;
  try {
    const result = await chat({
      tier: 'spark',
      carriesHubContext: options.carriesHubContext ?? true,
      temperature: 0,
      /* Sized for the model's reasoning, not for the JSON. The gateway's fast
         lane thinks inside the completion, and a ceiling cut to the size of the
         object comes back EMPTY — which the client correctly treats as a
         provider failure and which would then fail the whole turn over a
         routing decision that has a perfectly good fallback. */
      maxTokens: 700,
      signal: options.signal,
      messages: [
        { role: 'system', content: ROUTER_SYSTEM },
        /* THE DATE IS GIVEN, NEVER LEFT TO THE MODEL.
         *
         * The prompt says to include the current year for anything
         * time-sensitive, and the model obliged — with 2023 and 2024, the years
         * it was trained to think of as current. The searches then went looking
         * for a threshold that had changed twice since. A model does not know
         * what today is, and asking it to act on that is asking it to guess. */
        { role: 'user', content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\n${question}` }
      ]
    });
    text = result.text;
  } catch (error) {
    if (error instanceof StoppedError) throw error;
    return { route: 'research', queries: [keywordQuery(question)], reads: [], via: 'fallback' };
  }

  const parsed = extractJson(text);
  const route = ROUTES.includes(parsed?.route as Route) ? (parsed!.route as Route) : null;

  if (!route) {
    return { route: 'research', queries: [keywordQuery(question)], reads: [], via: 'fallback' };
  }

  const rawQueries = Array.isArray(parsed?.queries) ? (parsed!.queries as unknown[]) : [];
  const seen = new Set<string>();
  const queries = rawQueries
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.replace(/^[-*\d.)\s]+/, '').replace(/^["']|["']$/g, '').trim())
    .filter(looksLikeQuery)
    /* The planner repeats itself when a question has fewer angles than the
       slots it was offered, and each duplicate spends a search round trip to
       return pages that are deduplicated by URL afterwards anyway. */
    .filter((query) => {
      const key = query.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);

  const rawReads = Array.isArray(parsed?.reads) ? (parsed!.reads as unknown[]) : [];
  const reads = rawReads.filter((entry): entry is HubRead => READS.includes(entry as HubRead));

  const grounded = groundIfDomain(route, question);

  /* THE RULE'S OWN NAME GOES FIRST, ALONGSIDE WHAT THE PLANNER WROTE.
   *
   * Prepended rather than substituted: the planner's detailed query is the
   * better one for everything except finding the page that states the rule, and
   * the two find different things. Deduplicated in case the planner already
   * wrote it. See `rulePhraseQuery` for the failure this exists for. */
  const rulePhrase = grounded === 'research' ? rulePhraseQuery(question) : '';
  const withRule =
    rulePhrase && !queries.some((query) => query.toLowerCase() === rulePhrase.toLowerCase())
      ? [rulePhrase, ...queries]
      : queries;

  return {
    route: grounded,
    /* A research route with no usable query is a research route that would
       search for nothing, so the mechanical fallback fills in. */
    queries: grounded === 'research' && !withRule.length ? [keywordQuery(question)] : withRule,
    reads: grounded === 'hub' && !reads.length ? defaultReads(question) : reads,
    search: typeof parsed?.search === 'string' && parsed.search.trim() ? parsed.search.trim().slice(0, 80) : undefined,
    mineOnly: parsed?.mineOnly === true || /\b(my|i|me|mine)\b/i.test(question),
    needsCompany: parsed?.needsCompany === true,
    via: 'model'
  };
}

/* What to read when the router said "hub" but not which records. Guessed from
   the question's own nouns rather than reading everything: five reads to answer
   "what's on my calendar" is four queries of noise in the prompt. */
function defaultReads(question: string): HubRead[] {
  const text = question.toLowerCase();
  const reads: HubRead[] = [];

  if (/\b(team|colleague|staff|who works|who is on|who'?s on|people|member)\b/.test(text)) reads.push('team');
  if (/\b(task|to.?do|work|deadline|due|overdue|assign)\b/.test(text)) reads.push('tasks');
  if (/\b(calendar|diary|schedule|meeting|event|appointment|free|busy|week)\b/.test(text)) reads.push('calendar');
  if (/\b(client|customer|account)\b/.test(text)) reads.push('clients');
  if (/\b(project|matter|case)\b/.test(text)) reads.push('projects');

  return reads.length ? reads : ['standing'];
}

/* ---------- the mechanical fallback ---------- */

/* Reduce a question to a search query without a model.
 *
 * Falling back to the raw question was wrong for exactly the case that needs a
 * fallback: a short question is a passable query, a long one is not, and it is
 * the long detailed questions whose planner output gets rejected as prose. A
 * four-line case summary went to a search engine verbatim and returned two
 * sources, because no page matches a paragraph.
 *
 * Route and concept names come first wherever they appear in the sentence.
 * Taking the first few surviving words was wrong in the way that matters: a
 * case summary opens with the client's circumstances and names the route at the
 * end, so the applicant's arithmetic filled the query and "long residence" was
 * cut. What identifies the right page is the name of the rule. */
/**
 * The name of the rule, and nothing else.
 *
 * WHY THIS IS A SEPARATE QUERY RATHER THAN A BETTER ONE.
 *
 * Asked "my client has been here 9 years and 3 months with 210 days absent in
 * one 12 month period, can she still get ILR on long residence", the planner
 * produced "UK long residence ILR 10 years 210 days absent" — a reasonable
 * query, and GOV.UK's search returned 42 results that did not include
 * `gov.uk/long-residence`, the page which states the rule. The same search for
 * "indefinite leave to remain long residence" returned that page FIRST.
 *
 * The applicant's own figures are what did it. They are the most distinctive
 * tokens in the question and the least useful for finding a page: no page is
 * about 210 days, and every page about the rule is about "long residence". A
 * publisher's search index matches the query it is given, so a query carrying
 * the case details searches for the case rather than for the rule.
 *
 * Improving the ranking could not fix this — the right page was never in the
 * candidate pool. It needs a different query, run alongside rather than
 * instead, because the detailed query is the better one for everything except
 * finding the rule page.
 *
 * Returns an empty string when the question names no rule this file knows,
 * which is the honest outcome: there is nothing to add.
 */
export function rulePhraseQuery(question: string): string {
  const lower = question.toLowerCase();
  const phrases = DOMAIN_PHRASES.filter((phrase) => lower.includes(phrase));
  if (!phrases.length) return '';

  /* Longest first, then drop any phrase contained in one already taken: a
     question saying "indefinite leave to remain" also contains no shorter
     phrase worth adding, and "ilr" alongside it is noise. */
  const ordered = [...phrases].sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const phrase of ordered) {
    if (!kept.some((taken) => taken.includes(phrase))) kept.push(phrase);
  }

  return `UK ${kept.slice(0, 2).join(' ')}`;
}

export function keywordQuery(question: string): string {
  const lower = question.toLowerCase();
  const phrases = DOMAIN_PHRASES.filter((phrase) => lower.includes(phrase));

  const words = lower
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !QUERY_STOPWORDS.has(word))
    .filter((word) => !phrases.some((phrase) => phrase.includes(word)));

  const seen = new Set<string>();
  const distinct = words.filter((word) => (seen.has(word) ? false : (seen.add(word), true)));

  /* Jurisdiction is dropped by the length filter but decides which country's
     rules come back, so it is restored explicitly. */
  const jurisdiction = /\b(uk|united kingdom|britain|british)\b/i.test(question) ? 'UK' : '';

  const query = [jurisdiction, ...phrases, ...distinct.slice(0, 6)].filter(Boolean).join(' ').trim();
  return query.length > 8 ? query : question.replace(/[?]/g, '').trim().slice(0, 120);
}

/* Route and concept names this domain turns on. Matched as substrings so a
   question saying "indefinite leave to remain" and one saying "ILR" land on the
   same query. Extend as routes are added — a missing phrase degrades the
   fallback, it does not break it. */
const DOMAIN_PHRASES = [
  'indefinite leave to remain',
  'long residence',
  'continuous residence',
  'continuous lawful',
  'skilled worker',
  'health and care worker',
  'global talent',
  'high potential individual',
  'graduate visa',
  'student visa',
  'visit visa',
  'spouse visa',
  'partner visa',
  'family visa',
  'appendix fm',
  'right to work',
  'settled status',
  'pre-settled status',
  'eu settlement scheme',
  'naturalisation',
  'british citizenship',
  'certificate of sponsorship',
  'sponsor licence',
  'immigration salary list',
  'minimum salary',
  'financial requirement',
  'life in the uk',
  'asylum',
  'refugee',
  'human rights',
  'article 8',
  'deportation',
  'refusal',
  'administrative review',
  'ilr'
];

/* Deliberately broader than the ranking stoplist in `relevance.ts`: that one
   must preserve domain phrases like "leave to remain", while this one is only
   building a keyword query and benefits from dropping narrative filler. */
const QUERY_STOPWORDS = new Set([
  'the', 'and', 'but', 'for', 'with', 'that', 'this', 'these', 'those', 'they', 'them', 'their',
  'have', 'has', 'had', 'been', 'was', 'were', 'are', 'you', 'your', 'our', 'his', 'her',
  'would', 'could', 'should', 'shall', 'will', 'can', 'may', 'might', 'must', 'need',
  'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'does', 'did', 'doing',
  'give', 'tell', 'say', 'said', 'says', 'want', 'like', 'please', 'help', 'know',
  'client', 'case', 'now', 'then', 'than', 'also', 'any', 'some', 'all', 'one', 'two',
  'because', 'about', 'from', 'into', 'over', 'under', 'more', 'most', 'much', 'many',
  'choose', 'chose', 'options', 'option', 'think', 'thinking', 'best', 'better'
]);
