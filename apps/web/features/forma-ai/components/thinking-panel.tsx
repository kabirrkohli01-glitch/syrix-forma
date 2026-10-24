'use client';

/* What the assistant is actually doing, while it does it.
 *
 * EVERY LINE IN HERE HAPPENED. There are two sources and no third:
 *
 *   STAGES — emitted by `lib/ai/pipeline/answer.ts` as each step of the
 *   pipeline runs, carrying the real queries, the real source counts, the real
 *   route it chose. Timings are measured between frames arriving, not estimated.
 *
 *   THE MODEL'S OWN WORKING — captured from the completion by
 *   `lib/ai/pipeline/reasoning.ts`. These models think in the completion, and
 *   the guards strip that thinking out of the answer before anybody reads it.
 *   It is shown here on its way out. A line appears in this panel only if it
 *   was removed from the answer, so the two can never disagree.
 *
 * WHAT IT IS NOT. It does not invent steps to fill a wait, it does not show a
 * progress bar for work of unknown duration, and it does not animate anything
 * that is not a state change. The replaced version was a list of fixed labels
 * with a pulsing dot, which looked like activity and reported almost none.
 *
 * WHY IT READS AS ONE MOVING LINE RATHER THAN A GROWING BOX. While a turn is
 * running, the panel is a single line that crossfades as work moves on — the
 * question "what is it doing" has one answer at a time, and a list that grows
 * downward pushes the answer off the screen while it is being written. The full
 * trace is one click away and stays available after the turn finishes, which is
 * when somebody actually wants to audit it.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { cn } from '@/lib/utils';
import { Icons } from '@/components/icons';
import type { StageEntry } from '../store/conversation';

/* Human-readable names for the pipeline's stage keys. A stage with no entry
   here still renders — under its own key — rather than being hidden, so a new
   pipeline stage is visible the day it is added. */
const STAGE_LABELS: Record<string, string> = {
  routing: 'Working out what this needs',
  planning: 'Planning',
  searching: 'Searching',
  reading: 'Reading sources',
  hub: 'Reading Hub records',
  thinking: 'Thinking it through',
  council: 'The council',
  proposing: 'Preparing a proposal',
  trimming: 'Trimming to budget',
  answering: 'Writing the answer',
  checking: 'Checking figures against sources',
  warning: 'Flagged'
};

function label(entry: StageEntry): string {
  return STAGE_LABELS[entry.stage] ?? entry.stage;
}

/* ---------- the live line ---------- */

/* A quiet elapsed counter.
 *
 * Shown because these turns can run past a minute on the deeper modes and an
 * interface that says nothing for that long reads as broken. It counts real
 * seconds and makes no prediction — there is no honest estimate available for a
 * search whose page fetches have not finished. */
function Elapsed({ from }: { from: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.floor((now - from) / 1000));
  return <span className='tabular-nums'>{seconds}s</span>;
}

export function ThinkingPanel({
  stages,
  reasoning,
  running,
  startedAt,
  className
}: {
  stages: StageEntry[];
  reasoning: string[];
  running: boolean;
  startedAt: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const traceRef = useRef<HTMLDivElement>(null);

  /* Follow the trace only while it is open and only while work is arriving.
     Scrolling a panel the user opened to read something earlier in it is worse
     than not following. */
  useEffect(() => {
    if (open && running) traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight });
  }, [open, running, stages.length, reasoning.length]);

  if (!stages.length && !running) return null;

  const current = stages[stages.length - 1];
  /* The model's latest thought outranks the stage name while it is writing:
     "Checking whether the 12-month rule applies" says more than "Writing the
     answer", and it is the more recent of the two. */
  const thought = reasoning[reasoning.length - 1];
  const headline = running ? (thought ?? (current ? summarise(current) : 'Starting…')) : summariseDone(stages);

  return (
    <div
      className={cn(
        'border-border/50 bg-muted/25 overflow-hidden rounded-xl border text-xs',
        className
      )}
    >
      <button
        type='button'
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className='hover:bg-muted/40 flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors'
      >
        <span aria-hidden className='shrink-0'>
          {running ? (
            <Icons.spinner className={cn('text-muted-foreground size-3.5', !reduced && 'animate-spin')} />
          ) : (
            <Icons.check className='size-3.5 text-emerald-600 dark:text-emerald-500' />
          )}
        </span>

        {/* The line crossfades in place rather than the list growing. `mode="wait"`
            so two lines are never on screen at once, which reads as a stutter. */}
        <span className='min-w-0 flex-1'>
          <AnimatePresence mode='wait' initial={false}>
            <motion.span
              key={headline}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={cn('block truncate', running ? 'text-foreground/80' : 'text-muted-foreground')}
            >
              {headline}
            </motion.span>
          </AnimatePresence>
        </span>

        <span className='text-muted-foreground/70 shrink-0 tabular-nums'>
          {running ? <Elapsed from={startedAt} /> : `${stages.length} step${stages.length === 1 ? '' : 's'}`}
        </span>

        <Icons.chevronDown
          aria-hidden
          className={cn('text-muted-foreground/60 size-3.5 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className='overflow-hidden'
          >
            <div ref={traceRef} className='border-border/40 max-h-64 overflow-y-auto border-t px-3 py-2.5'>
              <Trace stages={stages} reasoning={reasoning} startedAt={startedAt} running={running} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* One line combining the stage and its detail. The detail is the informative
   half — "3 sources" and the actual query text are what make this a log rather
   than a label. */
function summarise(entry: StageEntry): string {
  const name = label(entry);
  return entry.detail ? `${name} — ${entry.detail}` : name;
}

function lastOf(stages: StageEntry[], stage: string): StageEntry | undefined {
  for (let index = stages.length - 1; index >= 0; index--) {
    if (stages[index]!.stage === stage) return stages[index];
  }
  return undefined;
}

function summariseDone(stages: StageEntry[]): string {
  const hub = lastOf(stages, 'hub');
  if (hub) return `Read Hub records — ${hub.detail ?? 'done'}`;

  const read = lastOf(stages, 'reading');
  if (read) return `Searched and read sources — ${read.detail ?? 'done'}`;

  if (lastOf(stages, 'searching')) return 'Searched the web';
  if (lastOf(stages, 'thinking')) return 'Thought it through — nothing to look up';
  return 'Answered without searching';
}

/* The full trace, interleaved in the order things happened.
 *
 * Stages and reasoning are separate streams and merging them by arrival time is
 * the only way the trace reads as one sequence. Reasoning lines carry no
 * timestamp of their own — they are attached to whichever stage was current
 * when they arrived, which is exactly where they belong. */
function Trace({
  stages,
  reasoning,
  startedAt,
  running
}: {
  stages: StageEntry[];
  reasoning: string[];
  startedAt: number;
  running: boolean;
}) {
  return (
    <div className='space-y-2'>
      <ol className='space-y-1.5'>
        {stages.map((entry, index) => {
          const isLast = index === stages.length - 1;
          const flagged = entry.stage === 'warning';
          /* Measured, not estimated: the gap to the next frame, or nothing at
             all for the step still running. */
          const next = stages[index + 1];
          const took = next ? next.at - entry.at : isLast && !running ? 0 : null;

          return (
            <li key={`${entry.stage}-${index}`} className='flex items-baseline gap-2'>
              <span
                aria-hidden
                className={cn(
                  'mt-1.5 size-1 shrink-0 rounded-full',
                  flagged ? 'bg-amber-500' : isLast && running ? 'bg-foreground/60' : 'bg-muted-foreground/30'
                )}
              />
              <span
                className={cn(
                  'shrink-0 font-medium',
                  flagged ? 'text-amber-600 dark:text-amber-500' : 'text-foreground/75'
                )}
              >
                {label(entry)}
              </span>
              {entry.detail ? (
                <span className='text-muted-foreground min-w-0 flex-1 break-words'>{entry.detail}</span>
              ) : (
                <span className='flex-1' />
              )}
              <span className='text-muted-foreground/50 shrink-0 tabular-nums'>
                {took === null ? '' : took >= 1000 ? `${(took / 1000).toFixed(1)}s` : `${took}ms`}
              </span>
            </li>
          );
        })}
      </ol>

      {reasoning.length ? (
        <div className='border-border/40 space-y-1 border-t pt-2'>
          <p className='text-muted-foreground/70 text-[0.65rem] font-medium tracking-wide uppercase'>
            Its own working
          </p>
          {reasoning.map((line, index) => (
            <p key={index} className='text-muted-foreground/90 leading-relaxed italic'>
              {line}
            </p>
          ))}
          <p className='text-muted-foreground/50 pt-0.5 text-[0.65rem]'>
            Written by the model while it worked, and removed from the answer below.
          </p>
        </div>
      ) : null}

      {/* Measured to the last frame that arrived, not to now. Reading the clock
          during render would make the total tick upward long after the turn had
          finished, which is a different claim from the one being made. */}
      <p className='text-muted-foreground/50 border-border/40 border-t pt-2 text-[0.65rem]'>
        {stages.length} step{stages.length === 1 ? '' : 's'}
        {running || !stages.length
          ? ''
          : ` · ${((stages[stages.length - 1]!.at - startedAt) / 1000).toFixed(1)}s to the last step`}
      </p>
    </div>
  );
}

/** Screen-reader announcement of the current stage, kept out of the visual flow. */
export function ThinkingStatus({ stages, running }: { stages: StageEntry[]; running: boolean }) {
  const current = stages[stages.length - 1];
  return (
    <p className='sr-only' role='status' aria-live='polite'>
      {running && current ? summarise(current) : ''}
    </p>
  );
}
