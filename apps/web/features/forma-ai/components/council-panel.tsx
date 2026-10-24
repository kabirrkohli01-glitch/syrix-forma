'use client';

/* What the council actually did.
 *
 * Collapsed by default: the answer is the deliverable and the reports are the
 * working. But they are one click away and never summarised away, because a
 * consultant checking a figure needs to see which specialist produced it and
 * what that specialist said was missing.
 *
 * A trimmed roster is shown OUTSIDE the collapse. An answer written by four
 * specialists instead of seven rests on less than it appears to, and a reader
 * who has to expand a panel to discover that has not really been told.
 */

import React, { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { AnswerText } from './answer-text';
import type { CouncilSummary } from '../store/conversation';

const CONFIDENCE_LABEL: Record<string, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence'
};

export function CouncilPanel({ council }: { council: CouncilSummary }) {
  const [open, setOpen] = useState(false);
  const written = council.reports.filter((report) => report.ok);

  return (
    <div className='space-y-2'>
      {council.trimmed ? (
        <p className='text-muted-foreground border-border/60 border-l-2 py-0.5 pl-2.5 text-xs'>
          {council.trimmed}
        </p>
      ) : null}

      <button
        type='button'
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className='text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded text-[0.7rem] font-medium tracking-wide uppercase focus-visible:ring-2 focus-visible:outline-none'
      >
        {open ? 'Hide' : 'Show'} the council — {written.length} specialist
        {written.length === 1 ? '' : 's'}
        {council.corrections.length
          ? `, ${council.corrections.length} correction${council.corrections.length === 1 ? '' : 's'}`
          : ''}
      </button>

      {open ? (
        <div className='border-border/60 space-y-4 rounded-lg border px-3 py-3'>
          {council.corrections.length ? (
            <div className='space-y-1.5'>
              <p className='text-muted-foreground text-[0.7rem] font-medium tracking-wide uppercase'>
                The review found, and the answer was rewritten to fix
              </p>
              <ul className='list-disc space-y-1 pl-4 text-xs'>
                {council.corrections.map((correction, index) => (
                  <li key={index} className='text-foreground/80'>
                    {correction}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {council.reports.map((report) => (
            <div key={report.id} className='space-y-1.5'>
              <div className='flex items-center gap-2'>
                <h5 className='text-foreground text-xs font-semibold'>{report.title}</h5>
                {report.confidence ? (
                  <Badge
                    variant='secondary'
                    className={cn(
                      'px-1.5 py-0 text-[0.65rem] font-medium',
                      report.confidence === 'low' && 'text-muted-foreground'
                    )}
                  >
                    {CONFIDENCE_LABEL[report.confidence]}
                  </Badge>
                ) : null}
              </div>

              {report.ok && report.text ? (
                <AnswerText text={report.text} className='text-xs' />
              ) : (
                <p className='text-muted-foreground text-xs italic'>
                  Did not report{report.reason ? ` — ${report.reason}` : ''}.
                </p>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
