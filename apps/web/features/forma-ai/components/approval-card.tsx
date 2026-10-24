'use client';

/* The yes/no card that stands between the assistant and any change to the Hub.
 *
 * WHAT MAKES IT A CONTROL RATHER THAN A CEREMONY:
 *
 *   IT SHOWS THE REAL VALUES. Every parameter, fully rendered — the actual due
 *   date, the actual title, the actual client's name. Never "a task for the
 *   Henderson matter", which is a summary of intent and could describe any
 *   number of different writes.
 *
 *   NOTHING IN IT IS INTERPRETED. Values render as text nodes, never as
 *   markdown and never as HTML. The values may originate from a document
 *   somebody uploaded, and a card that formatted its own contents could be
 *   handed a bold heading that says one thing above a body that does another.
 *
 *   DENY IS THE DEFAULT. It holds focus when the card appears, so Enter — the
 *   key somebody is already resting on after typing a question — declines. The
 *   safe outcome is the one you reach by not paying attention.
 *
 *   THE CLIENT APPROVES AN ID. The action and its parameters live on the
 *   server. This component cannot send a different action than the one it is
 *   displaying, because it never has one to send.
 *
 * There is no "approve all" and no "don't ask again", and there must never be.
 */

import React, { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import type { Proposal } from '../store/conversation';

export function ApprovalCard({
  proposal,
  onDecide,
  busy
}: {
  proposal: Proposal;
  onDecide: (verdict: 'approve' | 'deny') => void;
  busy?: boolean;
}) {
  const denyRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    denyRef.current?.focus();
  }, [proposal.id]);

  return (
    <section
      aria-label='Approval required'
      className='border-border bg-card overflow-hidden rounded-xl border shadow-sm'
    >
      <header className='border-border/60 flex items-center gap-2 border-b bg-amber-500/5 px-4 py-2.5'>
        <Icons.warning className='size-4 shrink-0 text-amber-600 dark:text-amber-500' aria-hidden />
        <div className='min-w-0'>
          <p className='text-sm font-semibold'>{proposal.summary}</p>
          <p className='text-muted-foreground text-xs'>
            Nothing has changed yet. This will touch {proposal.resource}.
          </p>
        </div>
      </header>

      <dl className='divide-border/50 divide-y'>
        {proposal.fields.map((field) => (
          <div key={field.label} className='grid grid-cols-[7rem_1fr] gap-3 px-4 py-2 text-sm'>
            <dt className='text-muted-foreground text-xs font-medium'>{field.label}</dt>
            {/* `whitespace-pre-wrap` so a multi-line note reads as it will be
                saved, and `break-words` so a long value cannot push the buttons
                off the card. */}
            <dd className='text-foreground/90 min-w-0 break-words whitespace-pre-wrap'>{field.value}</dd>
          </div>
        ))}
      </dl>

      {proposal.reason ? (
        <p className='text-muted-foreground border-border/50 border-t px-4 py-2 text-xs italic'>
          {proposal.reason}
        </p>
      ) : null}

      <footer className='border-border/60 flex items-center justify-end gap-2 border-t px-4 py-2.5'>
        <Button ref={denyRef} variant='outline' size='sm' disabled={busy} onClick={() => onDecide('deny')}>
          Don&apos;t do it
        </Button>
        <Button size='sm' disabled={busy} onClick={() => onDecide('approve')}>
          Go ahead
        </Button>
      </footer>
    </section>
  );
}

/** What happened once a card was answered. Replaces the card, never sits beside it. */
export function ApprovalOutcome({ outcome }: { outcome: { ok: boolean; message: string; href?: string } }) {
  return (
    <p
      className={
        outcome.ok
          ? 'flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400'
          : 'border-destructive/30 bg-destructive/5 text-destructive flex items-center gap-2 rounded-lg border px-3 py-2 text-xs'
      }
    >
      {outcome.ok ? (
        <Icons.circleCheck className='size-3.5 shrink-0' aria-hidden />
      ) : (
        <Icons.circleX className='size-3.5 shrink-0' aria-hidden />
      )}
      <span className='min-w-0'>{outcome.message}</span>
      {outcome.ok && outcome.href ? (
        <a href={outcome.href} className='ml-auto shrink-0 underline underline-offset-2'>
          Open it
        </a>
      ) : null}
    </p>
  );
}
