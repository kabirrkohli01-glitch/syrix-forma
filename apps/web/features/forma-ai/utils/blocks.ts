/* Turning an answer into blocks.
 *
 * Parsing lives here, apart from the components that draw it, for two reasons.
 * It is the part with the edge cases — a fence that has not finished arriving,
 * a ragged table row, a bare URL at the end of a sentence — so it is the part
 * worth testing directly. And it produces plain data: every block keeps the
 * exact source text the model wrote, which is what the copy buttons put on the
 * clipboard. A component that copied its own rendered output would hand the
 * user a language label and a "not sent" note along with their email.
 *
 * THE OUTPUT IS DATA, NEVER MARKUP. No stage of this produces HTML, and the
 * renderer that consumes it emits React elements only. The text being parsed
 * was written by a model that has just read attacker-controllable web pages, so
 * an `innerHTML` anywhere on this path would be the last step of an injection
 * chain the rest of the system exists to break.
 *
 * ANYTHING UNRECOGNISED STAYS PLAIN TEXT. An unstyled line is legible; a
 * mangled one is not.
 */

export interface EmailDraft {
  to?: string;
  cc?: string;
  subject?: string;
  body: string;
}

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: { text: string; depth: number }[] }
  | { kind: 'numbered'; items: { text: string; depth: number }[] }
  | { kind: 'checklist'; items: { text: string; done: boolean }[] }
  | { kind: 'callout'; lines: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'code'; language: string; code: string; complete: boolean }
  | ({ kind: 'email'; raw: string } & EmailDraft)
  | { kind: 'rule' };

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string }
  /** `[Source: label]`, emitted by the answer prompt after each supported claim. */
  | { kind: 'source'; label: string };

/* ---------- inline ---------- */

/* One pass, in priority order, so a construct cannot be half-consumed by a
   pattern that started inside it. Code spans come first: backticks are how
   somebody writes about markdown without it being interpreted, and a `**` inside
   them is two asterisks, not emphasis. */
const INLINE =
  /`([^`\n]+)`|\[Source:\s*([^\]]+)\]|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|(?<![\w*])\*([^*\n]+)\*(?![\w*])|(?<![\w_])_([^_\n]+)_(?![\w_])|(https?:\/\/[^\s<>"')\]]+)/g;

/* Trailing punctuation belongs to the sentence, not to the address. "See
   https://www.gov.uk/ilr." must not link a full stop, and a URL inside brackets
   must not swallow the closing one. */
function trimUrlTail(url: string): { url: string; tail: string } {
  const match = /[.,;:!?)\]]+$/.exec(url);
  if (!match) return { url, tail: '' };
  return { url: url.slice(0, match.index), tail: match[0] };
}

/**
 * Split a line into inline runs.
 *
 * Only http and https ever become links. Anything else — `javascript:`,
 * `data:`, a bare `mailto:` — stays as the characters it is, because a link is
 * the one thing on this page that acts when clicked.
 */
export function inlineRuns(text: string): Inline[] {
  const runs: Inline[] = [];
  let cursor = 0;

  const push = (run: Inline): void => {
    /* Adjacent text runs merge, so the renderer never emits a dozen fragments
       for one ordinary sentence. */
    const last = runs[runs.length - 1];
    if (run.kind === 'text' && last?.kind === 'text') last.text += run.text;
    else if (run.kind !== 'text' || run.text) runs.push(run);
  };

  INLINE.lastIndex = 0;

  for (let match = INLINE.exec(text); match; match = INLINE.exec(text)) {
    if (match.index > cursor) push({ kind: 'text', text: text.slice(cursor, match.index) });
    cursor = match.index + match[0].length;

    if (match[1] !== undefined) push({ kind: 'code', text: match[1] });
    else if (match[2] !== undefined) push({ kind: 'source', label: match[2].trim() });
    else if (match[3] !== undefined && match[4] !== undefined) {
      const { url, tail } = trimUrlTail(match[4]);
      push({ kind: 'link', text: match[3], url });
      if (tail) push({ kind: 'text', text: tail });
    } else if (match[5] !== undefined) push({ kind: 'bold', text: match[5] });
    else if (match[6] !== undefined) push({ kind: 'italic', text: match[6] });
    else if (match[7] !== undefined) push({ kind: 'italic', text: match[7] });
    else if (match[8] !== undefined) {
      const { url, tail } = trimUrlTail(match[8]);
      push({ kind: 'link', text: url, url });
      if (tail) push({ kind: 'text', text: tail });
    }
  }

  if (cursor < text.length) push({ kind: 'text', text: text.slice(cursor) });
  return runs;
}

/* ---------- block structure ---------- */

const FENCE = /^\s*```+\s*([\w+-]*)\s*$/;
/* A closing fence carries no language. A second opener with one starts a new
   block rather than ending this one — which is what a model writing two code
   samples in a row and forgetting a close actually produces. */
const CLOSING_FENCE = /^\s*```+\s*$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const HASH_HEADING = /^(#{1,6})\s+(.*)$/;
/* A line that is entirely one bold run is a section label, not a sentence that
   happens to be emphasised. */
const BOLD_HEADING = /^\*\*(.+?)\*\*:?$/;
const CHECK_ITEM = /^(\s*)[-*•]\s+\[([ xX])\]\s+(.*)$/;
const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/;
const CALLOUT = /^\s*>\s?(.*)$/;

/* A table row is a line with pipes at both ends or at least two pipes inside
   it. The alignment row (|---|:--:|) is structure, not content, and is dropped
   — but its presence is what confirms the block is a table rather than a
   sentence that happens to contain a vertical bar. */
function tableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isAlignmentRow(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  return trimmed.startsWith('|') || (trimmed.match(/\|/g) ?? []).length >= 2;
}

/** Two spaces of indent is one level. Capped: a deeply nested list is a table. */
function depthOf(indent: string): number {
  return Math.min(2, Math.floor(indent.replace(/\t/g, '  ').length / 2));
}

/* Headers at the top of an email block. Everything after the first blank line —
   or after the first line that is not a header — is the body, so a message that
   opens "Dear Mr Patel" is not mistaken for a malformed header. */
const EMAIL_HEADER = /^(to|cc|bcc|subject|re)\s*:\s*(.*)$/i;

export function parseEmail(source: string): EmailDraft {
  const lines = source.split('\n');
  const draft: EmailDraft = { body: '' };
  let index = 0;

  for (; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim()) continue;

    const header = EMAIL_HEADER.exec(line.trim());
    if (!header) break;

    const field = header[1]!.toLowerCase();
    const value = header[2]!.trim();
    if (field === 'to') draft.to = value;
    else if (field === 'cc' || field === 'bcc') draft.cc = value;
    else draft.subject = value;
  }

  draft.body = lines.slice(index).join('\n').replace(/^\n+/, '').trimEnd();
  return draft;
}

/**
 * Parse an answer into blocks.
 *
 * Runs on partial text during streaming, which is why an unterminated fence is
 * a complete block rather than an error: the alternative is a code sample that
 * renders as prose for the seconds it takes to arrive and then jumps into a box.
 */
export function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!.trimEnd();

    /* ---- fenced blocks, before anything else can claim their contents ---- */
    const fence = FENCE.exec(raw);
    if (fence) {
      const language = (fence[1] ?? '').toLowerCase();
      const body: string[] = [];
      let closed = false;
      let cursor = index + 1;

      for (; cursor < lines.length; cursor++) {
        if (CLOSING_FENCE.test(lines[cursor]!)) {
          closed = true;
          break;
        }
        body.push(lines[cursor]!);
      }

      const source = body.join('\n').replace(/\s+$/, '');
      index = cursor;

      if (language === 'email' || language === 'mail') {
        blocks.push({ kind: 'email', raw: source, ...parseEmail(source) });
      } else {
        blocks.push({ kind: 'code', language, code: source, complete: closed });
      }
      continue;
    }

    if (!raw.trim()) continue;

    /* ---- tables, consumed whole: a row means nothing without its header ---- */
    if (isTableRow(raw) && index + 1 < lines.length && isAlignmentRow(lines[index + 1]!)) {
      const header = tableCells(raw);
      const rows: string[][] = [];
      let cursor = index + 2;

      while (cursor < lines.length && isTableRow(lines[cursor]!) && !isAlignmentRow(lines[cursor]!)) {
        const cells = tableCells(lines[cursor]!);
        /* Padded or trimmed to the header's width. A ragged row otherwise shifts
           every cell after it into the wrong column, which silently changes what
           the table says. */
        rows.push(Array.from({ length: header.length }, (_unused, column) => cells[column] ?? ''));
        cursor++;
      }

      blocks.push({ kind: 'table', header, rows });
      index = cursor - 1;
      continue;
    }

    if (RULE.test(raw)) {
      blocks.push({ kind: 'rule' });
      continue;
    }

    const last = blocks[blocks.length - 1];

    /* Checked before plain bullets: "- [ ] chase the CoS" is a task, and a
       bullet renderer would draw the brackets as literal text. */
    const check = CHECK_ITEM.exec(raw);
    if (check) {
      const item = { text: check[3]!, done: check[2]!.toLowerCase() === 'x' };
      if (last?.kind === 'checklist') last.items.push(item);
      else blocks.push({ kind: 'checklist', items: [item] });
      continue;
    }

    const bullet = BULLET.exec(raw);
    if (bullet) {
      const item = { text: bullet[2]!, depth: depthOf(bullet[1]!) };
      if (last?.kind === 'bullets') last.items.push(item);
      else blocks.push({ kind: 'bullets', items: [item] });
      continue;
    }

    const numbered = NUMBERED.exec(raw);
    if (numbered) {
      const item = { text: numbered[2]!, depth: depthOf(numbered[1]!) };
      if (last?.kind === 'numbered') last.items.push(item);
      else blocks.push({ kind: 'numbered', items: [item] });
      continue;
    }

    const callout = CALLOUT.exec(raw);
    if (callout) {
      if (last?.kind === 'callout') last.lines.push(callout[1]!);
      else blocks.push({ kind: 'callout', lines: [callout[1]!] });
      continue;
    }

    const hash = HASH_HEADING.exec(raw.trim());
    if (hash) {
      blocks.push({ kind: 'heading', level: Math.min(3, hash[1]!.length), text: hash[2]! });
      continue;
    }

    const boldHeading = BOLD_HEADING.exec(raw.trim());
    if (boldHeading) {
      blocks.push({ kind: 'heading', level: 3, text: boldHeading[1]! });
      continue;
    }

    /* Consecutive plain lines are one paragraph: the model wraps prose across
       lines and rendering each as its own block doubles the spacing. */
    if (last?.kind === 'paragraph') last.text += ' ' + raw.trim();
    else blocks.push({ kind: 'paragraph', text: raw.trim() });
  }

  return blocks;
}

/** The whole email, in the form a mail client expects it pasted. */
export function emailToText(draft: EmailDraft): string {
  const headers = [
    draft.to ? `To: ${draft.to}` : null,
    draft.cc ? `Cc: ${draft.cc}` : null,
    draft.subject ? `Subject: ${draft.subject}` : null
  ].filter((line): line is string => line !== null);

  return headers.length ? `${headers.join('\n')}\n\n${draft.body}` : draft.body;
}
