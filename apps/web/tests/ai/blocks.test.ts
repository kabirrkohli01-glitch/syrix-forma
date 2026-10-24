import { describe, expect, it } from 'vitest';

import { emailToText, inlineRuns, parseEmail, toBlocks } from '@/features/forma-ai/utils/blocks';

describe('toBlocks — fenced content', () => {
  it('reads a fenced block as code, with its language', () => {
    const blocks = toBlocks('Here it is:\n\n```python\nprint("hi")\n```');

    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Here it is:' },
      { kind: 'code', language: 'python', code: 'print("hi")', complete: true }
    ]);
  });

  /* Answers stream in. A fence that has not closed yet has to render as the
     code it is going to be, or a snippet appears as prose for several seconds
     and then jumps into a box under the reader's eyes. */
  it('treats an unterminated fence as a code block that has not finished', () => {
    const blocks = toBlocks('```sql\nSELECT 1\nFROM tas');

    expect(blocks).toEqual([{ kind: 'code', language: 'sql', code: 'SELECT 1\nFROM tas', complete: false }]);
  });

  it('does not let a language on a second fence close the first', () => {
    const blocks = toBlocks('```js\na\n```\n\n```js\nb\n```');
    expect(blocks.map((block) => block.kind)).toEqual(['code', 'code']);
  });

  it('keeps markdown inside a fence literal', () => {
    const [block] = toBlocks('```text\n- not a bullet\n| not | a table |\n```');
    expect(block).toEqual({
      kind: 'code',
      language: 'text',
      code: '- not a bullet\n| not | a table |',
      complete: true
    });
  });

  it('reads an email fence as a draft with its headers split off', () => {
    const [block] = toBlocks(
      '```email\nTo: aisha@example.com\nSubject: Your ILR application\n\nDear Aisha,\n\nAll set.\n```'
    );

    expect(block).toEqual({
      kind: 'email',
      to: 'aisha@example.com',
      subject: 'Your ILR application',
      body: 'Dear Aisha,\n\nAll set.',
      raw: 'To: aisha@example.com\nSubject: Your ILR application\n\nDear Aisha,\n\nAll set.'
    });
  });
});

describe('parseEmail', () => {
  it('stops reading headers at the first line that is not one', () => {
    const draft = parseEmail('Dear Mr Patel,\n\nTo: is a word here.\n');
    expect(draft.to).toBeUndefined();
    expect(draft.body).toBe('Dear Mr Patel,\n\nTo: is a word here.');
  });

  it('survives a draft with no headers at all', () => {
    expect(parseEmail('Just the body.')).toEqual({ body: 'Just the body.' });
  });
});

describe('emailToText', () => {
  it('lays the headers out the way a mail client expects them pasted', () => {
    expect(emailToText({ to: 'a@b.com', subject: 'Hi', body: 'Body.' })).toBe(
      'To: a@b.com\nSubject: Hi\n\nBody.'
    );
  });

  it('is the body alone when there are no headers', () => {
    expect(emailToText({ body: 'Body.' })).toBe('Body.');
  });
});

describe('toBlocks — lists', () => {
  it('reads a checklist before it reads a bullet', () => {
    const [block] = toBlocks('- [ ] chase the CoS\n- [x] passport copy received');

    expect(block).toEqual({
      kind: 'checklist',
      items: [
        { text: 'chase the CoS', done: false },
        { text: 'passport copy received', done: true }
      ]
    });
  });

  it('records indentation as depth', () => {
    const [block] = toBlocks('- parent\n  - child');
    expect(block).toEqual({
      kind: 'bullets',
      items: [
        { text: 'parent', depth: 0 },
        { text: 'child', depth: 1 }
      ]
    });
  });
});

describe('toBlocks — tables and rules', () => {
  it('pads a ragged row to the header width rather than shifting the columns', () => {
    const [block] = toBlocks('| a | b |\n|---|---|\n| 1 |');
    expect(block).toEqual({ kind: 'table', header: ['a', 'b'], rows: [['1', '']] });
  });

  it('leaves a sentence containing a pipe as a sentence', () => {
    const blocks = toBlocks('Run it with cat foo | wc -l and see.');
    expect(blocks[0]!.kind).toBe('paragraph');
  });

  it('reads a bare rule as a separator', () => {
    expect(toBlocks('one\n\n---\n\ntwo').map((block) => block.kind)).toEqual([
      'paragraph',
      'rule',
      'paragraph'
    ]);
  });
});

describe('inlineRuns', () => {
  it('links http and https', () => {
    expect(inlineRuns('See https://www.gov.uk/ilr for the rule')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://www.gov.uk/ilr', url: 'https://www.gov.uk/ilr' },
      { kind: 'text', text: ' for the rule' }
    ]);
  });

  /* A link is the one thing on this page that acts when clicked, and the text
     was written after reading pages nobody vetted. */
  it('never links a scheme that is not http or https', () => {
    expect(inlineRuns('[click](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[click](javascript:alert(1))' }
    ]);
  });

  it('leaves a full stop out of the link', () => {
    const runs = inlineRuns('at https://www.gov.uk/ilr.');
    expect(runs).toContainEqual({ kind: 'link', text: 'https://www.gov.uk/ilr', url: 'https://www.gov.uk/ilr' });
    expect(runs[runs.length - 1]).toEqual({ kind: 'text', text: '.' });
  });

  it('treats what is inside backticks as literal', () => {
    expect(inlineRuns('use `**not bold**` here')).toEqual([
      { kind: 'text', text: 'use ' },
      { kind: 'code', text: '**not bold**' },
      { kind: 'text', text: ' here' }
    ]);
  });

  it('keeps a source marker as a marker', () => {
    expect(inlineRuns('£41,700 [Source: GOV.UK Skilled Worker visa]')).toEqual([
      { kind: 'text', text: '£41,700 ' },
      { kind: 'source', label: 'GOV.UK Skilled Worker visa' }
    ]);
  });

  /* Underscores inside an identifier are not emphasis. */
  it('does not italicise part of a word', () => {
    expect(inlineRuns('the work_status column')).toEqual([{ kind: 'text', text: 'the work_status column' }]);
  });
});
