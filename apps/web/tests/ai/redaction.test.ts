import { describe, expect, it } from 'vitest';
import {
  assertSafeToSend,
  EgressBlockedError,
  findLeaks,
  redact,
  rehydrate,
  type KnownValue
} from '@/lib/ai/redaction/redact';

/* These are the tests that make the privacy claim in docs/forma-ai-architecture.md
   §3 checkable rather than aspirational. Cloud inference means a third party
   sees the prompt, and the only thing standing between that and a client's
   identity is this module. */

const known: KnownValue[] = [
  { value: 'Jane Okafor', kind: 'PERSON' },
  { value: 'Adeyemi Okafor', kind: 'PERSON' },
  { value: 'GWF061234567', kind: 'REF' }
];

describe('redaction of known Hub values', () => {
  it('replaces a disclosed name everywhere it appears', () => {
    const { text, map } = redact(
      'Will Jane Okafor be refused? Jane Okafor has an overstay.',
      known
    );

    expect(text).not.toContain('Jane Okafor');
    expect(text).toContain('[PERSON_1]');
    expect(map.get('[PERSON_1]')).toBe('Jane Okafor');
  });

  it('gives one value one placeholder, so the model still reads it as one person', () => {
    const { text } = redact('Jane Okafor asked. Jane Okafor waited.', known);
    expect(text.match(/\[PERSON_1\]/g)).toHaveLength(2);
    expect(text).not.toContain('[PERSON_2]');
  });

  it('distinguishes two different people', () => {
    const { text, map } = redact('Jane Okafor is the partner of Adeyemi Okafor.', known);
    expect(map.size).toBe(2);
    expect(text).toContain('[PERSON_1]');
    expect(text).toContain('[PERSON_2]');
  });

  /* The bug this guards against: replacing the shorter value first leaves the
     surname stranded in the output, which is still identifying. */
  it('replaces the longest match first, leaving no fragment behind', () => {
    const overlapping: KnownValue[] = [
      { value: 'Jane', kind: 'PERSON' },
      { value: 'Jane Okafor', kind: 'PERSON' }
    ];
    const { text } = redact('Jane Okafor applied.', overlapping);
    expect(text).not.toContain('Okafor');
  });

  it('is case-insensitive, because a user types a name however they like', () => {
    const { text } = redact('what about JANE OKAFOR', known);
    expect(text.toLowerCase()).not.toContain('jane okafor');
  });
});

describe('pattern redaction for values no Hub record supplied', () => {
  it.each([
    ['an email', 'contact me at a.okafor@example.com please', 'a.okafor@example.com'],
    ['a National Insurance number', 'her NI is QQ123456C', 'QQ123456C'],
    ['a numeric date of birth', 'born 04/11/1991 in Lagos', '04/11/1991'],
    ['a written date of birth', 'born 4 November 1991 in Lagos', '4 November 1991'],
    ['a UK postcode', 'living at SW1A 1AA currently', 'SW1A 1AA'],
    ['a UK mobile number', 'call 07700 900123 tomorrow', '07700 900123']
  ])('removes %s', (_label, input, secret) => {
    const { text } = redact(input);
    expect(text).not.toContain(secret);
  });

  it('removes a labelled case reference but keeps the label readable', () => {
    const { text } = redact('case reference GWF061234567 was refused');
    expect(text).not.toContain('GWF061234567');
    expect(text).toContain('refused');
  });

  it('removes a labelled passport number', () => {
    const { text } = redact('passport number 123456789 expires soon');
    expect(text).not.toContain('123456789');
  });

  /* The failure that would make the whole feature useless: a detector eager
     enough to catch every reference number also eats the salary threshold, and
     an answer about "[REF_1] per year" helps nobody. */
  it('leaves money, thresholds and ordinary numbers alone', () => {
    const { text } = redact(
      'Is the £41,700 threshold met on a 37.5 hour week under the 2025 rules?'
    );
    expect(text).toContain('£41,700');
    expect(text).toContain('37.5');
    expect(text).toContain('2025');
  });

  it('leaves ordinary immigration vocabulary alone', () => {
    const input = 'Skilled Worker visa via the Home Office under Appendix FM';
    expect(redact(input).text).toBe(input);
  });
});

describe('rehydration', () => {
  it('restores the original text exactly', () => {
    const original = 'Will Jane Okafor, born 04/11/1991, be refused?';
    const { text, map } = redact(original, known);
    expect(text).not.toContain('Jane Okafor');
    expect(rehydrate(text, map)).toBe(original);
  });

  it('round-trips an answer that reuses the placeholders', () => {
    const { map } = redact('Jane Okafor applied.', known);
    const answer = '[PERSON_1] is likely eligible. [PERSON_1] should provide evidence.';
    expect(rehydrate(answer, map)).toBe(
      'Jane Okafor is likely eligible. Jane Okafor should provide evidence.'
    );
  });
});

describe('egress gate', () => {
  it('blocks a search query still carrying a client name', () => {
    expect(() =>
      assertSafeToSend("will Jane Okafor's spouse visa be refused", known)
    ).toThrow(EgressBlockedError);
  });

  it('allows the de-identified query that should go out instead', () => {
    expect(() =>
      assertSafeToSend('UK spouse visa refusal grounds previous overstay', known)
    ).not.toThrow();
  });

  it.each([
    ['an email', 'refusal advice for a.okafor@example.com'],
    ['a case reference', 'status of case reference GWF061234567'],
    ['a date of birth', 'applicant born 04/11/1991 eligibility'],
    ['a postcode', 'immigration adviser near SW1A 1AA']
  ])('blocks a query containing %s', (_label, query) => {
    expect(() => assertSafeToSend(query)).toThrow(EgressBlockedError);
  });

  /* A leak detector that quotes the leak has moved the data into a log rather
     than stopped it leaving. */
  it('never repeats the offending value in the error it raises', () => {
    try {
      assertSafeToSend("Jane Okafor's refusal", known);
      throw new Error('expected the gate to block this');
    } catch (error) {
      expect(error).toBeInstanceOf(EgressBlockedError);
      expect((error as Error).message).not.toContain('Jane Okafor');
    }
  });

  it('reports findings without including the values', () => {
    const findings = findLeaks('born 04/11/1991 at SW1A 1AA');
    expect(findings.length).toBeGreaterThanOrEqual(2);
    for (const finding of findings) {
      expect(finding.detail).not.toContain('04/11/1991');
      expect(finding.detail).not.toContain('SW1A 1AA');
    }
  });
});
