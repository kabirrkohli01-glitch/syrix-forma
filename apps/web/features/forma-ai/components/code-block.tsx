'use client';

/* A fenced block of code, a command, or JSON.
 *
 * HIGHLIGHTING IS DONE HERE, NOT BY A LIBRARY. Every syntax highlighter worth
 * having is either a large dependency or an HTML pipeline, and this codebase
 * cannot use the second at all: the text was written by a model that has just
 * read attacker-controllable pages, so the renderer emits React elements and
 * never markup. What is drawn instead is a small, language-agnostic pass —
 * strings, comments, numbers and the keywords common to the languages that
 * actually get asked for. It is deliberately approximate. Mis-tinting a word is
 * a cosmetic defect; the code itself is never altered, and the copy button
 * takes the original characters rather than anything drawn here.
 *
 * LONG BLOCKS COLLAPSE. A two-hundred-line file pushes the rest of the
 * conversation off the screen and buries the sentence that explains it.
 */

import React from 'react';

import { cn } from '@/lib/utils';

import { CopyButton } from './copy-button';

const COLLAPSED_LINES = 28;

/* Names as they should be shown, for the ones whose lowercase form looks like a
   typo. Anything not here is shown as written. */
const LANGUAGE_LABEL: Record<string, string> = {
  bash: 'Shell',
  sh: 'Shell',
  shell: 'Shell',
  zsh: 'Shell',
  ps1: 'PowerShell',
  powershell: 'PowerShell',
  js: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  tsx: 'TSX',
  py: 'Python',
  python: 'Python',
  sql: 'SQL',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  html: 'HTML',
  css: 'CSS',
  csv: 'CSV',
  xml: 'XML',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  php: 'PHP',
  rb: 'Ruby',
  ruby: 'Ruby',
  cs: 'C#',
  cpp: 'C++',
  c: 'C',
  diff: 'Diff',
  text: 'Text'
};

/* Shared across languages on purpose. A per-language keyword table would be
   four times the size and no more correct for the mixed snippets that actually
   turn up — a SQL query inside a Python string, a JSON body inside a curl. */
const KEYWORDS = new Set([
  'abstract', 'and', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'def', 'default', 'delete', 'do', 'elif', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'from', 'func', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface',
  'is', 'lambda', 'let', 'new', 'nil', 'none', 'not', 'null', 'or', 'package', 'pass', 'print',
  'private', 'protected', 'public', 'raise', 'return', 'select', 'self', 'static', 'struct', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var', 'void', 'while',
  'with', 'yield',
  /* SQL, upper-cased by convention but matched lowercase below. */
  'insert', 'update', 'delete', 'where', 'group', 'order', 'join', 'inner', 'outer', 'left', 'right',
  'having', 'limit', 'values', 'into', 'set', 'table', 'create', 'alter', 'drop'
]);

type Piece = { text: string; tone: 'plain' | 'string' | 'comment' | 'number' | 'keyword' };

/* Strings and comments are found first and taken whole, because everything
   inside them is content: a `#` in a URL does not start a comment, and the word
   `select` inside a sentence in a docstring is not a keyword. */
const TOKEN =
  /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_][\w$]*)/gi;

function highlight(code: string): Piece[] {
  const pieces: Piece[] = [];
  let cursor = 0;

  TOKEN.lastIndex = 0;

  for (let match = TOKEN.exec(code); match; match = TOKEN.exec(code)) {
    if (match.index > cursor) pieces.push({ text: code.slice(cursor, match.index), tone: 'plain' });
    cursor = match.index + match[0].length;

    if (match[1] !== undefined) pieces.push({ text: match[1], tone: 'string' });
    else if (match[2] !== undefined) pieces.push({ text: match[2], tone: 'comment' });
    else if (match[3] !== undefined) pieces.push({ text: match[3], tone: 'number' });
    else if (match[4] !== undefined) {
      pieces.push({
        text: match[4],
        tone: KEYWORDS.has(match[4].toLowerCase()) ? 'keyword' : 'plain'
      });
    }
  }

  if (cursor < code.length) pieces.push({ text: code.slice(cursor), tone: 'plain' });
  return pieces;
}

const TONE_CLASS: Record<Piece['tone'], string> = {
  plain: '',
  string: 'text-emerald-700 dark:text-emerald-400',
  comment: 'text-muted-foreground italic',
  number: 'text-amber-700 dark:text-amber-400',
  keyword: 'text-violet-700 dark:text-violet-400'
};

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [expanded, setExpanded] = React.useState(false);

  const lines = React.useMemo(() => code.split('\n'), [code]);
  const long = lines.length > COLLAPSED_LINES;
  const shown = long && !expanded ? lines.slice(0, COLLAPSED_LINES).join('\n') : code;
  const pieces = React.useMemo(() => highlight(shown), [shown]);

  const label = LANGUAGE_LABEL[language] ?? (language ? language : 'Code');

  return (
    <div className='border-border/70 bg-muted/30 overflow-hidden rounded-lg border'>
      <div className='border-border/50 bg-muted/50 flex items-center justify-between gap-2 border-b px-2.5 py-1'>
        <span className='text-muted-foreground font-mono text-[0.68rem] tracking-wide'>{label}</span>
        {/* The original, always — never the collapsed view. Copying a truncated
            file and finding out later is worse than not offering the button. */}
        <CopyButton text={code} />
      </div>

      {/* Scrolls inside itself. A long line must never make the conversation
          column scroll sideways — that moves the whole answer and the reader
          loses their place in it. */}
      <pre className='overflow-x-auto px-3 py-2.5 text-[0.78rem] leading-relaxed'>
        <code className='font-mono'>
          {pieces.map((piece, index) => (
            <span key={index} className={cn(TONE_CLASS[piece.tone])}>
              {piece.text}
            </span>
          ))}
        </code>
      </pre>

      {long ? (
        <button
          type='button'
          onClick={() => setExpanded((open) => !open)}
          className='border-border/50 text-muted-foreground hover:text-foreground w-full border-t px-3 py-1.5 text-left text-[0.7rem] font-medium transition-colors'
        >
          {expanded ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      ) : null}
    </div>
  );
}
