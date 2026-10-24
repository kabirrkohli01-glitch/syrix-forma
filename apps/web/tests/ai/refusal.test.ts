import { describe, expect, it } from 'vitest';

import { looksLikeRefusal, usedSources } from '@/lib/ai/guards/guards';
import { missesTheSubject, subjectTerms } from '@/lib/ai/pipeline/evidence';

/* The two texts below are the shapes the live assistant actually produced, and
   they are the reason both of these checks exist. Neither question needed a
   source that could not be found; the second needed no source at all. */
const NVIDIA_REFUSAL =
  'The provided sources contain no information about the company\'s financials, ownership, news, or ' +
  'technical trends. Without data on revenue growth, earnings, free cash flow, debt, valuation, ' +
  'institutional ownership, insider activity, recent news, or price action, I cannot construct an ' +
  'investment analysis. Any figures or statements about the company would be unsupported speculation, ' +
  'which I must avoid.';

const RISK_REFUSAL =
  'The supplied sources do not contain any information about the technical, privacy, cybersecurity, ' +
  'regulatory, or ethical risks associated with deploying such a system. Because no factual basis for ' +
  'those risks is provided in the sources, I cannot identify, rank, or propose mitigations for them. ' +
  'Additional authoritative sources would be required to answer the question.';

describe('looksLikeRefusal', () => {
  it.each([
    ['a refusal for want of financial sources', NVIDIA_REFUSAL],
    ['a refusal to reason about risk', RISK_REFUSAL],
    ['a flat inability', 'I am unable to provide an answer using the sources given.'],
    ['a question thrown back', 'This cannot be answered from the pages retrieved.']
  ])('catches %s', (_name, text) => {
    expect(looksLikeRefusal(text)).toBe(true);
  });

  /* THE CASES THAT MUST NOT TRIP IT. An answer that does its work and then names
     what it could not establish is the behaviour the freshness rules ask for —
     catching it here would replace a sourced answer with an unsourced one. */
  it('leaves an answer that names its own gaps alone', () => {
    const answer =
      'The current minimum salary for a Skilled Worker is **£41,700 a year** [Source: GOV.UK Skilled ' +
      'Worker visa], or the going rate for the occupation code if that is higher. New entrants and ' +
      'shortage occupations are lower. The pages I found do not state the 2027 figure, so that one ' +
      'needs checking against the published rule before you quote it to anyone. ' +
      'The going rates themselves are set out in a separate annex which was not retrieved here.';

    expect(looksLikeRefusal(answer)).toBe(false);
  });

  it('leaves an ordinary inability to see an attachment alone', () => {
    expect(looksLikeRefusal('I cannot see the second page of the letter — the scan cut off at the fold.')).toBe(
      false
    );
  });

  it('does not catch a long answer that happens to use the words', () => {
    const long =
      'Working through it: ' +
      'x'.repeat(1900) +
      ' Without the filing itself I cannot confirm the exact figure.';

    expect(looksLikeRefusal(long)).toBe(false);
  });

  it('is false for an empty completion rather than throwing', () => {
    expect(looksLikeRefusal('')).toBe(false);
  });
});

describe('usedSources', () => {
  const sources = [
    { label: 'Skilled Worker visa' },
    { label: 'Indefinite leave to remain if you have a Skilled Worker, Health and Care Worker, T2 or Tier 2 visa' },
    { label: 'Check your visa processing time - GOV.UK' }
  ];

  /* The failure this exists for: three BBC articles and "Check your visa
     processing time" listed underneath them as a source. It drops the page that
     had nothing to do with the answer; two GOV.UK titles that genuinely overlap
     are both kept, which is the honest outcome — both were read. */
  it('drops a page the answer never cited', () => {
    const answer = 'The threshold is £41,700 [Source: Skilled Worker visa].';
    const kept = usedSources(answer, sources).map((source) => source.label);

    expect(kept).toContain('Skilled Worker visa');
    expect(kept).not.toContain('Check your visa processing time - GOV.UK');
  });

  /* A model shortens a long title as often as it copies it, and containment
     alone dropped a page the answer plainly stood on. */
  it('matches an abbreviated citation to its source', () => {
    const answer = 'Settlement takes five years [Source: ILR for Skilled Worker].';
    expect(usedSources(answer, sources).map((source) => source.label)).toContain(
      'Indefinite leave to remain if you have a Skilled Worker, Health and Care Worker, T2 or Tier 2 visa'
    );
  });

  /* Never empties the list: showing what was read is imperfect, showing nothing
     under a sourced answer is worse. */
  it('keeps everything when the answer cited nothing', () => {
    expect(usedSources('No marks at all in this one.', sources)).toHaveLength(3);
  });

  it('keeps everything when no citation matches any source', () => {
    expect(usedSources('A figure [Source: something else entirely].', sources)).toHaveLength(3);
  });
});

describe('subjectTerms', () => {
  it('takes the proper nouns and skips the first word of a sentence', () => {
    expect(subjectTerms('Analyse Nvidia as an investment using the latest information')).toEqual(['Nvidia']);
  });

  it('finds nothing in a question typed in lower case', () => {
    expect(subjectTerms('whats the skiled worker slary threshhold')).toEqual([]);
  });

  it('does not treat a capitalised opening word as the subject', () => {
    expect(subjectTerms('What is the current fee')).toEqual([]);
  });
});

describe('missesTheSubject', () => {
  const junk = [
    { label: '2025 in the United States - Wikipedia', text: 'Revenue growth, debt and cash markets in 2026.' },
    { label: 'Julia (programming language) - Wikipedia', text: 'Julia is a high-level language with free tooling.' }
  ];

  /* Word overlap is high here — revenue, growth, debt, cash, free, 2026 — which
     is exactly why coverage alone let this through. */
  it('spots pages that share the vocabulary and none of the subject', () => {
    expect(missesTheSubject('Analyse Nvidia as an investment covering revenue growth and debt', junk)).toBe(true);
  });

  it('is satisfied by one subject term appearing', () => {
    const sources = [{ label: 'Skilled Worker visa', text: 'You can apply for a Skilled Worker visa.' }];
    expect(missesTheSubject('Does a Skilled Worker need a new CoS', sources)).toBe(false);
  });

  it('says nothing when the question has no proper nouns to check', () => {
    expect(missesTheSubject('how much does it cost', junk)).toBe(false);
  });
});
