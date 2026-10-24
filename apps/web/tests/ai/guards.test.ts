import { describe, expect, it } from 'vitest';
import { clean, dropRepeats, stripNarration, unsupportedFigures } from '@/lib/ai/guards/guards';

const sources = [
  {
    label: 'GOV.UK Skilled Worker visa',
    text: 'The minimum salary for the type of work you will be doing is whichever is the highest of: £41,700 per year, or the going rate for the type of work.'
  }
];

describe('narration stripping', () => {
  it('drops a narrated preamble and keeps the answer', () => {
    const result = stripNarration(
      "We need to answer the user's question about salary.\nLet's craft the answer:\nThe general salary threshold is £41,700 per year for most Skilled Worker applicants."
    );
    expect(result).not.toContain('We need to');
    expect(result).toContain('£41,700');
  });

  it('leaves an answer that never narrated alone', () => {
    const answer = 'The general salary threshold is £41,700 per year for most applicants.';
    expect(stripNarration(answer)).toBe(answer);
  });

  /* The guard must never be able to produce an empty reply. */
  it('keeps the original when it cannot tell narration from answer', () => {
    const allNarration = 'We need to think.\nLet me consider.\nI should check.';
    expect(stripNarration(allNarration)).toBe(allNarration);
  });
});

describe('repeat dropping', () => {
  it('removes a duplicated sentence', () => {
    const result = dropRepeats(
      'The threshold rose in July 2025.\nSomething else entirely here.\nThe threshold rose in July 2025.'
    );
    expect(result.match(/The threshold rose/g)).toHaveLength(1);
  });

  it('keeps repeated headings and bullets, which legitimately recur', () => {
    const text = '## Eligibility\n- item one here now\n## Evidence\n- item one here now';
    expect(dropRepeats(text).split('\n')).toHaveLength(4);
  });
});

describe('unsupported figures — the anti-hallucination guard', () => {
  it('accepts a figure that appears in a source', () => {
    expect(unsupportedFigures('The threshold is £41,700 per year.', sources)).toEqual([]);
  });

  it('flags a figure that appears in no source', () => {
    const flagged = unsupportedFigures('The threshold is £38,700 per year.', sources);
    expect(flagged).toContain('£38,700');
  });

  it('matches across formatting differences', () => {
    expect(unsupportedFigures('The threshold is £ 41700 per year.', sources)).toEqual([]);
  });

  it('flags an invented percentage', () => {
    expect(unsupportedFigures('Roughly 63% of applications succeed.', sources)).toContain('63%');
  });

  it('flags an invented duration', () => {
    expect(unsupportedFigures('You must wait 18 months before applying.', sources)).toContain('18 months');
  });

  /* An answer full of flags trains the reader to ignore them, so the guard is
     narrow on purpose and must not fire on incidental numbers. */
  it('ignores incidental numbers that are not claims', () => {
    const flagged = unsupportedFigures('There are two options, set out in section 3.', sources);
    expect(flagged).toEqual([]);
  });

  it('reports nothing when there are no sources to check against', () => {
    expect(unsupportedFigures('The threshold is £41,700.', [])).toEqual([]);
  });
});

describe('the full pass', () => {
  it('cleans and reports in one go', () => {
    const report = clean(
      "We need to answer this.\nThe general salary threshold is £41,700 per year, and the going rate may be higher.",
      sources
    );
    expect(report.text).not.toContain('We need to');
    expect(report.unsupportedFigures).toEqual([]);
    expect(report.applied).toContain('removed process narration');
  });

  it('surfaces an invented figure rather than deleting it', () => {
    const report = clean('The fee is £1,846 for this route.', sources);
    /* Removing the number would leave "The fee is for this route" reading as
       authoritative while saying nothing. */
    expect(report.text).toContain('£1,846');
    expect(report.unsupportedFigures).toContain('£1,846');
  });

  it('never returns an empty answer', () => {
    const report = clean('Let me think.', sources);
    expect(report.text.trim().length).toBeGreaterThan(0);
  });
});

/* The product decision recorded in guards.ts: Vantage strips recommendations
   because it must not give financial advice. SYRIX AI must NOT strip them —
   consultants are paid to reach a view, and an assistant that researches
   thoroughly then refuses to conclude has withheld the useful part. These
   assert that the reasoning survives intact. */
describe('recommendations are preserved, not stripped', () => {
  it.each([
    ['a recommended route', 'I would apply under the 5-year partner route rather than the 10-year route, because the financial requirement is met.'],
    ['a comparison with a reason', 'Option B is stronger: the applicant already holds continuous leave, so long residence is the safer argument.'],
    ['a direct instruction', 'You should gather six months of payslips before submitting the application.'],
    ['a judgement of risk', 'This application is likely to be refused on suitability grounds given the previous overstay.']
  ])('keeps %s intact', (_label, answer) => {
    expect(clean(answer, sources).text).toBe(answer);
  });
});
