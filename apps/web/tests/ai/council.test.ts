import { describe, expect, it } from 'vitest';

import {
  extractJson,
  parsePlan,
  parseReview,
  readConfidence,
  wantsCouncil,
  withoutConfidence
} from '../../lib/ai/council/council';
import { dropInlineNarration } from '../../lib/ai/guards/guards';

describe('extractJson', () => {
  it('finds an object inside a code fence', () => {
    expect(extractJson('```json\n{"roster":["risk"]}\n```')).toEqual({ roster: ['risk'] });
  });

  /* Models preface JSON with prose however firmly they are asked not to. */
  it('finds an object surrounded by prose', () => {
    expect(extractJson('Sure! Here is the plan:\n{"roster":["risk"]}\nHope that helps.')).toEqual({
      roster: ['risk']
    });
  });

  it('returns null when there is no object', () => {
    expect(extractJson('no json here')).toBeNull();
  });
});

describe('parsePlan', () => {
  it('keeps only known specialists', () => {
    const plan = parsePlan('{"roster":["eligibility","nonsense","risk"]}', 7);
    expect(plan?.roster).toEqual(['eligibility', 'risk']);
  });

  it('drops duplicates so one specialist cannot occupy two slots', () => {
    const plan = parsePlan('{"roster":["risk","risk","eligibility"]}', 7);
    expect(plan?.roster).toEqual(['risk', 'eligibility']);
  });

  it('never returns more specialists than the run can afford', () => {
    const plan = parsePlan('{"roster":["eligibility","financial","documents","timeline","risk"]}', 2);
    expect(plan?.roster).toHaveLength(2);
  });

  it('returns null when no usable specialist was named, so the default roster is used', () => {
    expect(parsePlan('{"roster":["nonsense"]}', 7)).toBeNull();
  });

  it('carries the per-specialist brief through', () => {
    const plan = parsePlan('{"roster":["risk"],"focus":{"risk":"look at overstay"}}', 7);
    expect(plan?.focus.risk).toBe('look at overstay');
  });
});

describe('parseReview', () => {
  it('reads the corrections list', () => {
    expect(parseReview('{"corrections":["The £29,000 figure is in no source."]}')).toEqual([
      'The £29,000 figure is in no source.'
    ]);
  });

  /* An empty list is the expected result and must not be turned into work. */
  it('treats an empty list as nothing to fix', () => {
    expect(parseReview('{"corrections":[]}')).toEqual([]);
  });

  it('discards entries too short to be a real finding', () => {
    expect(parseReview('{"corrections":["ok","A real finding about a missing figure."]}')).toEqual([
      'A real finding about a missing figure.'
    ]);
  });

  it('returns nothing when the reply is not JSON at all', () => {
    expect(parseReview('looks fine to me')).toEqual([]);
  });
});

describe('readConfidence', () => {
  /* Read loosely on purpose: a parser insisting on one exact form reported most
     of the desk as having no view, which is a parsing failure presented as a
     desk that would not commit. */
  it('reads the plain form', () => {
    expect(readConfidence('Report body.\nCONFIDENCE: high — unless the rule changes.')).toBe('high');
  });

  it('reads a decorated form', () => {
    expect(readConfidence('Body.\n**Confidence:** medium, would change if dates differ')).toBe('medium');
  });

  it('normalises "moderate" to medium', () => {
    expect(readConfidence('Body.\nConfidence — moderate')).toBe('medium');
  });

  it('returns null when the specialist gave none', () => {
    expect(readConfidence('Body with no closing line.')).toBeNull();
  });
});

describe('withoutConfidence', () => {
  it('removes the confidence line from the displayed body', () => {
    const text = 'The threshold is stated.\nCONFIDENCE: high — unless the rule changes.';
    expect(withoutConfidence(text)).toBe('The threshold is stated.');
  });

  it('leaves a body alone when it carries no confidence line', () => {
    expect(withoutConfidence('Just the report.')).toBe('Just the report.');
  });
});

describe('wantsCouncil', () => {
  it('recognises a question asking for a recommendation', () => {
    expect(wantsCouncil('What are their options and which would you recommend?')).toBe(true);
  });

  it('does not escalate a plain lookup', () => {
    expect(wantsCouncil('What is the Skilled Worker minimum salary?')).toBe(false);
  });
});

describe('dropInlineNarration', () => {
  /* The failure this exists for: a model that starts answering, breaks off to
     talk to itself, and resumes. Anchoring on the first answer-like line cannot
     reach any of it, because all of it is downstream of the anchor. */
  it('removes narration that appears after the answer has started', () => {
    const text = [
      '**Settlement options**',
      'The client reaches five years in three months and may then apply for indefinite leave to remain.',
      'We need to bold figures and dates: e.g., **£285**, **5 years**.',
      'Now produce answer in markdown, lead with direct answer.',
      'The spouse may apply as a dependant on the existing visa at a fee of £285.'
    ].join('\n');

    const out = dropInlineNarration(text);

    expect(out).not.toContain('We need to bold');
    expect(out).not.toContain('Now produce answer');
    expect(out).toContain('indefinite leave to remain');
    expect(out).toContain('dependant on the existing visa');
  });

  it('leaves an answer with no narration untouched', () => {
    const text = '**Answer**\nThe minimum salary is £38,700 from 4 April 2024.';
    expect(dropInlineNarration(text)).toBe(text);
  });

  /* Nothing here may ever empty an answer — an untidy answer beats none. */
  it('keeps the original when narration was most of what there was', () => {
    const text = 'We need to answer this.\nLet me think.';
    expect(dropInlineNarration(text)).toBe(text);
  });
});
