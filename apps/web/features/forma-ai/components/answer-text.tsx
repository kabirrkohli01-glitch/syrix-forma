'use client';

/* Drawing an answer.
 *
 * A deliberately small renderer rather than a markdown library, for one reason:
 * it produces React elements and never HTML. The text being rendered is written
 * by a model that has just read attacker-controllable web pages, so an
 * `innerHTML` path here would be the last step of an injection chain that every
 * other layer is built to break. Nothing below can emit a tag.
 *
 * WHAT IT SUPPORTS AND WHY THE LIST KEEPS GROWING. Each addition follows the
 * same rule: a renderer that supports something the model is never told about
 * will never draw it, and a model told about something the renderer cannot draw
 * writes syntax at the reader. So this file and the presentation section of
 * `lib/ai/pipeline/answer.ts` change together, always.
 *
 * It began with headings, bullets, numbered points and bold, which made every
 * answer look the same — a comparison of three routes came out as twelve
 * sentences, correct and unscannable. Tables and callouts followed. Then code,
 * emails and checklists, because the assistant is asked for a snippet, a draft
 * or a list of things to chase as often as it is asked about a rule, and each
 * of those is content somebody has to get back OUT of the page intact. That is
 * what the copy buttons are for, and why they take the source text rather than
 * the rendering.
 *
 * Parsing lives in `../utils/blocks`, where it can be tested without a DOM.
 */

import React from 'react';

import { cn } from '@/lib/utils';

import { inlineRuns, toBlocks, type Block, type Inline } from '../utils/blocks';
import { CodeBlock } from './code-block';
import { EmailCard } from './email-card';

function InlineRuns({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((run, index) => {
        if (run.kind === 'bold') {
          return (
            <strong key={index} className='text-foreground font-semibold'>
              {run.text}
            </strong>
          );
        }

        if (run.kind === 'italic') {
          return (
            <em key={index} className='italic'>
              {run.text}
            </em>
          );
        }

        if (run.kind === 'code') {
          return (
            <code
              key={index}
              className='bg-muted text-foreground/90 rounded px-1 py-0.5 font-mono text-[0.82em]'
            >
              {run.text}
            </code>
          );
        }

        if (run.kind === 'link') {
          /* `blocks.ts` admits http and https only, so there is no scheme here
             that can act on click. `noreferrer` matters as much as `noopener`:
             the destination is often a page the assistant was pointed at by
             another page. */
          return (
            <a
              key={index}
              href={run.url}
              target='_blank'
              rel='noopener noreferrer nofollow'
              className='text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid'
            >
              {run.text}
            </a>
          );
        }

        if (run.kind === 'source') {
          return (
            <span
              key={index}
              className='bg-muted text-muted-foreground mx-0.5 inline-block max-w-[18rem] truncate rounded px-1.5 py-0.5 align-baseline text-[0.7rem] leading-none'
              title={run.label}
            >
              {run.label}
            </span>
          );
        }

        return <React.Fragment key={index}>{run.text}</React.Fragment>;
      })}
    </>
  );
}

/* Memoised on the string, so an inline pass does not re-run for every block on
   every token of a streaming answer. */
function Line({ text }: { text: string }) {
  const runs = React.useMemo(() => inlineRuns(text), [text]);
  return <InlineRuns runs={runs} />;
}

const INDENT_CLASS = ['', 'ml-5', 'ml-10'] as const;

function BlockView({ block }: { block: Block }) {
  if (block.kind === 'heading') {
    /* Level decides weight, not size: three nested sizes inside a chat bubble
       read as three different fonts. Only the top level gets a rule under it. */
    return (
      <p
        className={cn(
          'text-foreground pt-1 font-semibold tracking-tight',
          block.level === 1
            ? 'border-border/50 border-b pb-1 text-[0.9rem]'
            : block.level === 2
              ? 'text-[0.84rem]'
              : 'text-[0.8rem]'
        )}
      >
        <Line text={block.text} />
      </p>
    );
  }

  if (block.kind === 'bullets') {
    return (
      <ul className='marker:text-muted-foreground/50 list-disc space-y-1.5 pl-5'>
        {block.items.map((item, index) => (
          <li key={index} className={cn('pl-0.5', INDENT_CLASS[item.depth])}>
            <Line text={item.text} />
          </li>
        ))}
      </ul>
    );
  }

  if (block.kind === 'numbered') {
    return (
      <ol className='marker:text-muted-foreground/50 list-decimal space-y-1.5 pl-5'>
        {block.items.map((item, index) => (
          <li key={index} className={cn('pl-0.5', INDENT_CLASS[item.depth])}>
            <Line text={item.text} />
          </li>
        ))}
      </ol>
    );
  }

  if (block.kind === 'checklist') {
    /* Not interactive, and it must not look interactive. Ticking a box here
       would change nothing anywhere — the list is something to copy into the
       Hub or into a task, not a record of state. */
    return (
      <ul className='space-y-1.5'>
        {block.items.map((item, index) => (
          <li key={index} className='flex items-start gap-2'>
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border text-[0.6rem] leading-none',
                item.done ? 'border-transparent bg-emerald-600 text-white' : 'border-border'
              )}
            >
              {item.done ? '✓' : ''}
            </span>
            <span className={cn(item.done && 'text-muted-foreground')}>
              <span className='sr-only'>{item.done ? 'Done: ' : 'To do: '}</span>
              <Line text={item.text} />
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (block.kind === 'callout') {
    return (
      <div className='border-l-2 border-foreground/40 bg-foreground/5 py-2 pr-3 pl-3 text-[0.82rem]'>
        {block.lines.map((line, index) => (
          <p key={index} className='text-foreground/85'>
            <Line text={line} />
          </p>
        ))}
      </div>
    );
  }

  if (block.kind === 'table') {
    return (
      /* Scrolls inside itself. A wide comparison table must never make the
         conversation column scroll sideways — that moves the whole answer and
         the user loses their place in it. */
      <div className='border-border/60 overflow-x-auto rounded-lg border'>
        <table className='w-full border-collapse text-left text-[0.8rem]'>
          <thead className='bg-muted/50'>
            <tr>
              {block.header.map((cell, index) => (
                <th
                  key={index}
                  scope='col'
                  className='text-foreground/80 border-border/50 border-b px-3 py-2 font-semibold whitespace-nowrap'
                >
                  <Line text={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className='border-border/40 border-b last:border-0'>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className='text-foreground/85 px-3 py-2 align-top'>
                    <Line text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.kind === 'code') {
    return <CodeBlock code={block.code} language={block.language} />;
  }

  if (block.kind === 'email') {
    return <EmailCard draft={block} />;
  }

  if (block.kind === 'rule') {
    return <hr className='border-border/50' />;
  }

  return (
    <p className='text-foreground/90'>
      <Line text={block.text} />
    </p>
  );
}

export function AnswerText({ text, className }: { text: string; className?: string }) {
  const blocks = React.useMemo(() => toBlocks(text), [text]);

  return (
    <div className={cn('space-y-3.5 text-sm leading-relaxed', className)}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}
