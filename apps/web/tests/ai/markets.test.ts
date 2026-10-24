import { describe, expect, it } from 'vitest';

import { annuals, companyIn, looksLikeCompanyQuestion } from '@/lib/ai/research/markets';

describe('companyIn', () => {
  it('takes the company out of a question about it', () => {
    expect(companyIn('Analyse Nvidia as an investment covering revenue growth and debt')).toBe('Nvidia');
  });

  it('keeps a multi-word name together', () => {
    expect(companyIn('what is Rolls Royce revenue this year')).toBe('Rolls Royce');
  });

  it('finds nothing in a question about a rule', () => {
    expect(companyIn('what is the current skilled worker salary threshold')).toBeNull();
  });
});

describe('looksLikeCompanyQuestion', () => {
  it.each([
    'Analyse Nvidia as an investment — revenue, free cash flow, debt and valuation',
    'How has Apple revenue changed over the last two years?',
    'What is the Tesla share price'
  ])('sends %#. to the filings and the market', (question) => {
    expect(looksLikeCompanyQuestion(question)).toBe(true);
  });

  /* A capitalised name is not enough on its own, or every question naming the
     Home Office would fetch a balance sheet. */
  it.each([
    'What is the current Skilled Worker salary threshold?',
    'Does the Home Office publish processing times for ILR?',
    'Compare the Skilled Worker and Global Talent routes'
  ])('leaves %#. alone', (question) => {
    expect(looksLikeCompanyQuestion(question)).toBe(false);
  });
});

describe('annuals', () => {
  const year = (end: string, start: string, val: number, filed: string) => ({
    start,
    end,
    val,
    form: '10-K',
    filed
  });

  it('takes the fiscal years, newest first', () => {
    const figures = annuals([
      year('2026-01-25', '2025-01-27', 215_900_000_000, '2026-02-25'),
      year('2025-01-26', '2024-01-29', 130_500_000_000, '2025-02-26')
    ]);

    expect(figures.map((figure) => figure.end)).toEqual(['2026-01-25', '2025-01-26']);
    expect(figures[0]?.value).toBe(215_900_000_000);
  });

  /* A quarter filed under the same tag would otherwise be read as a year and
     make revenue look like it collapsed. */
  it('ignores a quarter', () => {
    const figures = annuals([
      year('2026-01-25', '2025-01-27', 215_900_000_000, '2026-02-25'),
      year('2025-10-26', '2025-07-28', 57_000_000_000, '2025-11-19')
    ]);

    expect(figures).toHaveLength(1);
  });

  it('ignores anything that is not an annual report', () => {
    expect(annuals([{ ...year('2026-01-25', '2025-01-27', 1, '2026-02-25'), form: '8-K' }])).toEqual([]);
  });

  /* The same year appears in later filings as a comparative. The most recently
     filed statement of it is the restated one. */
  it('prefers the most recently filed statement of the same year', () => {
    const figures = annuals([
      year('2025-01-26', '2024-01-29', 130_000_000_000, '2025-02-26'),
      year('2025-01-26', '2024-01-29', 130_500_000_000, '2026-02-25')
    ]);

    expect(figures).toHaveLength(1);
    expect(figures[0]?.value).toBe(130_500_000_000);
  });

  /* `Number(null)` is 0 and 0 is finite — the trap that turns an unpublished
     figure into a reported one. */
  it('drops an entry with no value rather than reading it as zero', () => {
    expect(annuals([{ ...year('2026-01-25', '2025-01-27', 0, '2026-02-25'), val: null }])).toEqual([]);
  });
});
