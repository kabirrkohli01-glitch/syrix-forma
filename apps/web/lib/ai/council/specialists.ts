/* The council's members.
 *
 * The remit is written as an instruction to a person, because that is what
 * produces a report rather than a summary — the same reason it works on the
 * desk this is ported from.
 *
 * WHAT EACH ONE READS IS THE POINT. Vantage's specialists select named sections
 * of a structured dossier ("price", "fundamentals"), which does not exist here:
 * the evidence is web pages, and their structure is whatever the publisher
 * chose. So each specialist carries `reads` — the vocabulary its part of the
 * question is written in — and the same lexical ranker that picks which
 * sections of a page answer the question picks which sections answer THIS
 * specialist's part of it.
 *
 * That preserves the property that makes a council worth its requests: each
 * pass reads a small, relevant slice closely instead of the whole dossier
 * loosely. Handing all seven the same text would be asking one model the same
 * question seven times, which averages nothing.
 */

export interface Specialist {
  id: string;
  title: string;
  /** Shown in the process panel while this member is working. */
  step: string;
  /** Terms this specialist's slice of the evidence is selected against. */
  reads: string;
  remit: string;
}

export const SPECIALISTS: Specialist[] = [
  {
    id: 'eligibility',
    title: 'Eligibility and route',
    step: 'Checking which route applies',
    reads: 'eligibility requirements route criteria qualify apply conditions suitability who can apply',
    remit:
      'You decide which route the situation actually falls under and what the applicant must satisfy to use ' +
      'it. Name the route in the publisher\'s own words, not a colloquial name. List the requirements as ' +
      'conditions to be met, not as prose. If more than one route is open, say which and what separates ' +
      'them. If the facts given do not settle which route applies, say exactly which missing fact would.'
  },
  {
    id: 'financial',
    title: 'Money',
    step: 'Checking the financial requirements',
    reads: 'salary threshold minimum income fee cost funds maintenance financial requirement £ payment charge',
    remit:
      'You handle every figure in money. Salary thresholds, maintenance funds, application fees, the ' +
      'immigration health surcharge, and anything else with a currency symbol on it. EVERY AMOUNT CARRIES ' +
      'THE DATE IT TOOK EFFECT — a threshold without a date is not usable, because these change more often ' +
      'than any other part of the rules. Where a figure has been superseded, give the current one and say ' +
      'what it replaced and when. If an amount you need is not in the evidence, say it is not there rather ' +
      'than supplying one you recall.'
  },
  {
    id: 'documents',
    title: 'Evidence and documents',
    step: 'Listing the required evidence',
    reads: 'documents evidence specified proof certificate letter translation supporting required provide',
    remit:
      'You say what must actually be supplied and in what form. Specified-document rules are the point: a ' +
      'document in the wrong format is a refusal, so where the rules dictate the form — originals, ' +
      'certified translations, a date window, an issuing body — say so. Distinguish what is mandatory from ' +
      'what is merely helpful. Note anything commonly supplied that does NOT satisfy the rule.'
  },
  {
    id: 'timeline',
    title: 'Time and validity',
    step: 'Working out the timings',
    reads: 'processing time how long weeks days valid validity expire extension window period duration wait',
    remit:
      'You handle duration and dates. Processing times, how long a grant lasts, when an extension may be ' +
      'made, what expires when, and any window an application must fall inside. Where the question gives ' +
      'the applicant\'s own dates, do the arithmetic against them and state the result plainly rather than ' +
      'leaving it to the reader. Say which timings are published service standards and which are ' +
      'guarantees, because they are not the same thing.'
  },
  {
    id: 'changes',
    title: 'Recent and pending changes',
    step: 'Checking what has changed',
    reads: 'change update new rules statement of changes from april introduced amended replaced transitional',
    remit:
      'You track what has changed and what is about to. Statements of changes, transitional provisions, and ' +
      'anything with a commencement date. THE TRANSITIONAL CASE IS YOUR MOST VALUABLE FINDING: where an ' +
      'older rule still governs applications or circumstances that began before a cutoff, say so explicitly ' +
      'and give the cutoff, because that is the case a general answer gets wrong. If the evidence shows ' +
      'nothing changing, say that — a stable rule is a finding too.'
  },
  {
    id: 'country',
    title: 'Country and nationality',
    step: 'Checking country-specific conditions',
    reads: 'nationality country national visa national of citizens passport exempt list requirement country',
    remit:
      'You handle everything that turns on nationality or country of residence: visa-national status, ' +
      'country-specific documentary requirements, exemptions, and conditions in the country concerned where ' +
      'they bear on the application. If the question does not state a nationality, say plainly that the ' +
      'answer varies by it and name the ways it varies rather than assuming one.'
  },
  {
    id: 'risk',
    title: 'The case against',
    step: 'Building the case against',
    reads: 'refusal refused grounds fail rejected breach non-compliance deception curtailment appeal review',
    remit:
      'YOUR JOB IS TO FIND WHAT MAKES THIS FAIL. Assume the straightforward reading is wrong and argue that ' +
      'side properly, not as a disclaimer. Name the specific refusal ground that bites, the fact that would ' +
      'trigger it, and what the applicant would have to show to avoid it. General suitability grounds are ' +
      'in scope. Do not hedge — a hedge is not the case against, it is the absence of one. If the evidence ' +
      'genuinely shows no material risk, say that plainly instead of manufacturing one.'
  }
];

export const BY_ID: Record<string, Specialist> = Object.fromEntries(
  SPECIALISTS.map((specialist) => [specialist.id, specialist])
);

/* Used when the conductor cannot be reached, ordered by how often each matters
   to the questions this desk actually receives. */
export const DEFAULT_ROSTER = ['eligibility', 'financial', 'timeline', 'documents', 'changes', 'risk'];
