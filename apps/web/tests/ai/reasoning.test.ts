import { describe, expect, it } from 'vitest';

import { clean } from '../../lib/ai/guards/guards';
import { ReasoningSplitter } from '../../lib/ai/pipeline/reasoning';

/* Feed a completion through the splitter the way the stream would. */
function capture(text: string, chunkSize = 7): string[] {
  const seen: string[] = [];
  const splitter = new ReasoningSplitter((line) => seen.push(line));

  for (let index = 0; index < text.length; index += chunkSize) {
    splitter.push(text.slice(index, index + chunkSize));
  }
  splitter.finish();

  return seen;
}

describe('ReasoningSplitter', () => {
  it('captures the preamble a model writes before it starts answering', () => {
    const seen = capture(
      [
        'We need to answer the question about the salary threshold.',
        "Let's check what the sources actually say.",
        '',
        'The general threshold is £38,700 a year for most applicants.'
      ].join('\n')
    );

    expect(seen).toEqual([
      'We need to answer the question about the salary threshold.',
      "Let's check what the sources actually say."
    ]);
  });

  it('captures narration that appears after the answer has started', () => {
    const seen = capture(
      [
        'The general threshold is £38,700 a year for most applicants.',
        'Now produce the rest in markdown.',
        'It is lower for new entrants.'
      ].join('\n')
    );

    expect(seen).toEqual(['Now produce the rest in markdown.']);
  });

  /* THE INVARIANT THAT MAKES SHOWING THIS SAFE. Anything the panel displays has
     to be something the guards remove from the answer — otherwise the same
     sentence appears twice, once labelled as the assistant's private working
     and once as its answer, and a reader cannot tell which they are looking at. */
  it('only ever shows lines the guards strip out of the answer', () => {
    const completion = [
      'We need to work out whether the absence rule bites here.',
      "Let's take the constraints one at a time.",
      '',
      '**Short answer**',
      'Yes — 210 days in a single 12-month period is over the limit.',
      'We should keep this under 150 words.',
      'The application would be refused on continuous residence.'
    ].join('\n');

    const shown = capture(completion);
    const answer = clean(completion).text;

    expect(shown.length).toBeGreaterThan(0);
    for (const line of shown) {
      expect(answer).not.toContain(line);
    }
  });

  it('never eats a plain answer that has no narration in it', () => {
    const completion = [
      'The fee is £2,885 for the main applicant.',
      'Each dependant pays the same amount.'
    ].join('\n');

    expect(capture(completion)).toEqual([]);
    expect(clean(completion).text).toBe(completion);
  });

  /* Tokens arrive at arbitrary boundaries, including mid-word and mid-newline.
     A splitter that classified partial lines would emit half a sentence and
     then have to take it back. */
  it('gives the same result whatever the token boundaries are', () => {
    const completion = ['We need to check the dates.', '', 'The deadline is 28 days from the decision.'].join(
      '\n'
    );

    expect(capture(completion, 1)).toEqual(capture(completion, 3));
    expect(capture(completion, 3)).toEqual(capture(completion, 1000));
  });

  it('does nothing at all when no listener is attached', () => {
    const splitter = new ReasoningSplitter();
    expect(() => {
      splitter.push('We need to answer this.\n');
      splitter.finish();
    }).not.toThrow();
  });
});
