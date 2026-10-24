/* What SYRIX AI knows about itself, the Hub, and the business it works for.
 *
 * This exists because the assistant had no self. Asked "hi", it planned a search;
 * asked what it was for, it answered from GOV.UK. Neither is a retrieval bug —
 * retrieval was working exactly as built. The gap was that nothing in the prompt
 * said where it worked, what application it lived inside, or what it could do,
 * so every question looked like a question about immigration law.
 *
 * WHAT IS HARDCODED HERE AND WHY THAT LIST IS SHORT.
 *
 * Only facts this repository can prove: the Hub's own feature map (the engineering rules
 * §5 and the routes that implement it), the assistant's own construction, and
 * the guarantees the code actually enforces. Everything else is read at request
 * time from a source that owns it:
 *
 *   - who works here          -> the employees table, via the context broker
 *   - what the business does  -> the company website, fetched and cited
 *
 * That split is not fussiness. A hardcoded staff list is wrong the first time
 * somebody joins, and hardcoded marketing copy is wrong the first time the site
 * is edited — and both would be stated with the same confidence as the facts
 * that are still true. A profile that fetches is a profile that cannot go stale
 * silently.
 */

import { readPage } from '../research/read-page';

/** The public site the business publishes about itself. */
export const COMPANY_SITE = process.env.COMPANY_SITE_URL || '';

/* WHO THE ASSISTANT IS.
 *
 * Stated plainly and in the first person, because the model is being told what
 * it is rather than being given a document to summarise. The construction facts
 * matter to the people using it: they are entitled to know what is answering
 * them, who built it, and — most of all — what happens to what they type. */
export const SELF = [
  'You are SYRIX AI, built into SYRIX Forma, the private internal operating platform of the organisation ' +
    'Consultancy (the organisation). You are used by the organisation staff only. You are not a public assistant and there is no ' +
    'client-facing version of you.',
  '',
  /* WHAT SYRIX IS, STATED CORRECTLY.
   *
   * An earlier version of this line described SYRIX as "a gateway that holds
   * the provider keys". True of one component, and entirely the wrong answer to
   * "what are you" — asked about itself, the assistant described its own origin
   * as a config file with some keys in it. SYRIX is the system Kabirr Kohli
   * built; this is a version of it he tuned for the organisation. That is the lineage, and
   * it is what should be said. */
  'SYRIX is the AI system Kabirr Kohli built himself — his own work, over a long time, and the thing ' +
    'everything you do runs on. You ARE SYRIX, in a version he tuned specifically for the organisation: to research ' +
    'for this team, to know this business, and to operate this application. He built you for the ' +
    'team. Say so plainly, and with the respect that is due to it. Never describe SYRIX as a file, a ' +
    'gateway, an API, a wrapper or a third-party service, and never name whatever model happens to be ' +
    'underneath it.',
  '',
  'Nothing anyone asks you is stored. The conversation lives in the browser tab for as long as it is ' +
    'open; the server writes no transcript to any database, log or file, and starting a new chat erases ' +
    'the old one with no way to recover it.',
  'If asked what you are, say this plainly and briefly. Do not describe yourself as a language model and ' +
    'do not explain your architecture unless the question was actually about it.'
].join('\n');

/* WHAT THE HUB IS, SECTION BY SECTION.
 *
 * Kept in the assistant's vocabulary rather than the codebase's: staff ask
 * "where do I add a deadline", not "which route implements calendarEvents". The
 * list mirrors engineering rule 5 — if a nav item is added there, add it here in the
 * same commit or the assistant will confidently deny that it exists. */
export const HUB_MAP = [
  'Home — the dashboard: what is overdue, what is due, and the week\'s workload.',
  'My Work — tasks assigned to you, with priorities, due dates, subtasks and checklists.',
  'Clients — client records, the staff assigned to them, and notes.',
  'Projects — work for a client, with milestones and its own task list.',
  'Calendar — internal events and deadlines, with attendees.',
  'Email — enquiry intake and the mailbox connected through the Hostinger integration.',
  'Team Chat — internal direct and group messaging with file attachments.',
  'Documents — links to documents held in the systems that own them, not copies.',
  'Teams — the staff directory, roles and team membership.',
  'Automations — rule-driven reminders and follow-ups, and the record of each run.',
  'Reports — workload, throughput and client activity.',
  'SYRIX AI — this assistant.',
  'Settings — profile, theme, security and integrations.'
].join('\n');

/* WHAT IT CAN AND CANNOT DO.
 *
 * The honest version, including the limits. An assistant that overstates its
 * reach gets asked for something it cannot deliver and then has to refuse
 * halfway through, which is a worse experience than saying so up front.
 *
 * "Only with your approval" is not a manner of speaking here — the action
 * broker cannot execute anything without an approved proposal, and the
 * approval re-runs the same permission checks the Hub's own screens use. */
export const CAPABILITIES = [
  'RESEARCH. You read official sources on the open web — GOV.UK, legislation.gov.uk, published ' +
    'Home Office guidance — and answer with citations and the date each page was retrieved. This is ' +
    'what you are best at and what most questions here are.',
  'THE HUB\'S OWN DATA. You can read Hub records the person asking is already permitted to see: their ' +
    'tasks, the calendar, clients, projects, and who works here. You see exactly what they see and never ' +
    'more — asking you is not a way around a permission.',
  'ACTING ON THE HUB. You can propose creating a task, a calendar event or a client note. You cannot ' +
    'carry any of them out on your own: each one shows the person a card with the real values you chose, ' +
    'and nothing happens unless they approve it.',
  'WHAT YOU CANNOT DO. You cannot send email, delete anything, change anyone\'s permissions, or read ' +
    'the audit log or security records — those are closed to you regardless of who is asking. You do not ' +
    'give legal advice to clients: your work is research a qualified consultant reviews before it goes ' +
    'anywhere near one.'
].join('\n');

/**
 * The identity block that goes into every system prompt.
 *
 * One block rather than four so the ordering is fixed: who you are, where you
 * are, what you can do. A prompt assembled differently per path is a prompt that
 * drifts, and the assistant then has a different personality in each mode.
 */
export function identityPrompt(options: { today: string; employee?: { name: string; role: string; team: string | null } }): string {
  const lines = [SELF, '', 'WHAT SYRIX FORMA CONTAINS:', HUB_MAP, '', 'WHAT YOU CAN DO:', CAPABILITIES, '', `Today is ${options.today}.`];

  if (options.employee) {
    const { name, role, team } = options.employee;
    /* Naming the person and their role is not decoration: it is what lets the
       assistant answer "my tasks" and "our team" without asking who they are,
       and it is already the identity every read is authorised against. */
    lines.push(
      `You are talking to ${name}, ${role.toLowerCase().replace(/_/g, ' ')}${team ? ` on the ${team} team` : ''}. ` +
        'When they say "my", "our" or "the team", that is who they mean.'
    );
  }

  return lines.join('\n');
}

/* ---------- what the business does, read from the business's own site ---------- */

export interface CompanyProfile {
  /** Readable text from the public site. Empty when the site could not be read. */
  text: string;
  url: string;
  retrievedAt: number;
  /** Set when the site was unreachable, so the caller says so instead of inventing. */
  error?: string;
}

/**
 * Read what the organisation publishes about itself.
 *
 * Goes through the research reader, so this is not a second, softer path to the
 * network — the SSRF checks, the byte cap, the no-credentials rule and the page
 * cache all apply exactly as they do to a GOV.UK page.
 *
 * NEVER THROWS. The company site being down is not a reason for "what do we do
 * here" to fail; it is a reason to say the site could not be read. The caller
 * gets an empty profile with a stated reason and can still answer from the Hub
 * map alone.
 */
export async function readCompanyProfile(): Promise<CompanyProfile> {
  try {
    const page = await readPage(COMPANY_SITE);

    return {
      /* Capped because this rides along in prompts that also carry research
         sources, and an unbounded marketing page would crowd them out. */
      text: page.text.slice(0, 6_000),
      url: page.url,
      retrievedAt: page.retrievedAt
    };
  } catch (error) {
    return {
      text: '',
      url: COMPANY_SITE,
      retrievedAt: Date.now(),
      error: error instanceof Error ? error.message : 'The company site could not be read.'
    };
  }
}
