import { describe, expect, it } from 'vitest';

import { selectSources } from '../../lib/ai/research/relevance';
import type { SearchResult } from '../../lib/ai/research/search';

function result(partial: Partial<SearchResult> & Pick<SearchResult, 'url' | 'title'>): SearchResult {
  return {
    snippet: '',
    engine: 'test',
    authority: 'unverified',
    ...partial
  } as SearchResult;
}

/* The page that states the rule, titled the way GOV.UK titles it: by topic, and
   in the publisher's own vocabulary rather than the asker's. */
const CASEWORKER_GUIDANCE = result({
  url: 'https://www.gov.uk/government/publications/indefinite-leave-to-remain-calculating-continuous-period-in-uk',
  title: 'Calculating continuous lawful period: caseworker guidance',
  snippet: 'How to calculate a continuous lawful period of residence for settlement applications.',
  authority: 'official'
});

const OFF_TOPIC_OFFICIAL = result({
  url: 'https://www.gov.uk/tax-foreign-income',
  title: 'Tax on foreign income',
  snippet: 'Paying tax on income earned abroad, residence and domicile.',
  authority: 'official'
});

const BLOG = result({
  url: 'https://example-immigration-firm.co.uk/ilr-long-residence-absences-guide',
  title: 'ILR Long Residence Absences: Continuous Lawful Residence Rules Explained 2026',
  snippet:
    'Our guide to ILR under long residence covers continuous lawful residence, absent days, months and years.',
  authority: 'unverified'
});

describe('selectSources — authority gate', () => {
  const candidates = [BLOG, OFF_TOPIC_OFFICIAL, CASEWORKER_GUIDANCE];

  /* The defect this guards against: the gate measured matched terms as a SHARE
     of the query, so the bar rose with question length. A detailed case summary
     rejected every official source and the answer was built from commentary
     that repeated the question's wording — the opposite of what should happen
     as a question gets more specific. */
  it('keeps the primary source when the question is long and detailed', () => {
    const detailed =
      'A client has 9 years and 3 months continuous lawful leave in the UK but was absent 210 days in one 12-month period. What are their options for ILR under long residence, and which would you recommend?';

    const selection = selectSources(detailed, candidates, { official: 1, general: 2 });

    expect(selection.official.map((source) => source.url)).toContain(CASEWORKER_GUIDANCE.url);
  });

  it('keeps the primary source when the same question is asked briefly', () => {
    const selection = selectSources('UK long residence continuous lawful residence', candidates, {
      official: 1,
      general: 2
    });

    expect(selection.official.map((source) => source.url)).toContain(CASEWORKER_GUIDANCE.url);
  });

  /* The gate still has to do its job: authority must not rescue a page about
     something else. Loosening it to a term count is only safe while this holds. */
  it('does not let authority rescue a page that shares nothing with the question', () => {
    const selection = selectSources(
      'skilled worker visa minimum salary threshold',
      [OFF_TOPIC_OFFICIAL, BLOG],
      { official: 2, general: 2 }
    );

    expect(selection.official.map((source) => source.url)).not.toContain(OFF_TOPIC_OFFICIAL.url);
  });

  it('never returns more primary sources than were asked for', () => {
    const selection = selectSources('UK long residence continuous lawful residence', candidates, {
      official: 1,
      general: 2
    });

    expect(selection.official).toHaveLength(1);
  });
});
