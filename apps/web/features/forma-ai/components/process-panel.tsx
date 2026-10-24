'use client';

/* What the pipeline is actually doing, while it does it.
 *
 * The stage names, source counts and queries here are the real ones emitted by
 * `lib/ai/pipeline/answer.ts` — nothing is invented to fill the wait. That is
 * the whole justification for this component existing under a house rule that
 * bans decorative animation: it is an activity log that happens to update, held
 * to the same standard as a test runner's output. No glow, no pulse, no
 * particles, no spinning orb.
 *
 * Motion is confined to a stage arriving and to the indeterminate marker on the
 * step in progress, because the duration of a search or a page fetch is genuinely
 * unknown and a progress bar would be a lie. `prefers-reduced-motion` collapses
 * it to static text.
 */

import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { cn } from '@/lib/utils';
import type { StageEntry } from '../store/conversation';

/* Human-readable names for the pipeline's stage keys. A stage with no entry
   here still renders — under its own key — rather than being hidden, so a new
   pipeline stage is visible the day it is added. */
const STAGE_LABELS: Record<string, string> = {
  planning: 'Planning',
  searching: 'Searching',
  reading: 'Reading sources',
  council: 'The council',
  trimming: 'Trimming to budget',
  answering: 'Writing the answer',
  checking: 'Checking figures against sources',
  warning: 'Flagged'
};

export function ProcessPanel({
  stages,
  running,
  className
}: {
  stages: StageEntry[];
  running: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();

  if (!stages.length && !running) return null;

  return (
    <div className={cn('border-border/60 bg-muted/30 rounded-lg border px-3 py-2.5', className)}>
      <ol className='space-y-1.5'>
        <AnimatePresence initial={false}>
          {stages.map((entry, index) => {
            const isLast = index === stages.length - 1;
            const active = running && isLast;
            const flagged = entry.stage === 'warning';

            return (
              <motion.li
                key={`${entry.stage}-${index}`}
                initial={reduced ? false : { opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className='flex items-baseline gap-2 text-xs'
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-1.5 size-1.5 shrink-0 rounded-full',
                    flagged
                      ? 'bg-amber-500'
                      : active
                        ? cn('bg-foreground/70', !reduced && 'animate-pulse')
                        : 'bg-muted-foreground/35'
                  )}
                />
                <span className={cn('shrink-0 font-medium', flagged ? 'text-amber-600 dark:text-amber-500' : 'text-foreground/80')}>
                  {STAGE_LABELS[entry.stage] ?? entry.stage}
                </span>
                {entry.detail ? (
                  <span className='text-muted-foreground min-w-0 truncate' title={entry.detail}>
                    {entry.detail}
                  </span>
                ) : null}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>

      {running && !stages.length ? (
        <p className='text-muted-foreground text-xs'>Starting…</p>
      ) : null}
    </div>
  );
}

/** Screen-reader announcement of the current stage, kept out of the visual flow. */
export function ProcessStatus({ stages, running }: { stages: StageEntry[]; running: boolean }) {
  const current = stages[stages.length - 1];
  return (
    <p className='sr-only' role='status' aria-live='polite'>
      {running && current
        ? `${STAGE_LABELS[current.stage] ?? current.stage}${current.detail ? `: ${current.detail}` : ''}`
        : ''}
    </p>
  );
}
