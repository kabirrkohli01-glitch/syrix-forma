'use client';

/* The small note beside the composer.
 *
 * Every claim in it is one this codebase actually keeps, which is the only
 * reason it is worth showing. "Nothing is stored" is true because the server
 * writes no transcript and the conversation lives in the tab; "it needs your
 * approval" is true because the action broker cannot execute without one. A
 * disclosure that overstated either would be worse than none — it would teach
 * people to trust a guarantee that was not there.
 *
 * It is a marker and a popover rather than a permanent paragraph because the
 * information is worth having once and not worth reading on every turn. The
 * marker itself carries the important half — that answers can be wrong — so
 * somebody who never opens it has still seen the thing that matters.
 */

import React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';

export function DisclosureNote({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type='button'
            aria-label='About SYRIX AI'
            className={cn(
              'text-muted-foreground/70 hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded text-[0.7rem] transition-colors focus-visible:ring-2 focus-visible:outline-none',
              className
            )}
          >
            <Icons.alertCircle className='size-3.5 shrink-0' aria-hidden />
            <span>SYRIX AI can make mistakes — check anything that matters</span>
          </button>
        }
      />
      <PopoverContent side='top' align='start' className='w-80 text-xs leading-relaxed'>
        <div className='space-y-2.5'>
          <div>
            <p className='text-foreground text-sm font-semibold'>About SYRIX AI</p>
            <p className='text-muted-foreground'>Built into SYRIX Forma for the team.</p>
          </div>

          <p className='text-foreground/85'>
            <strong className='font-semibold'>It can be wrong.</strong> Answers are research for you to
            review, not advice to pass on. Check figures, dates and deadlines against the source it cites
            before anything reaches a client.
          </p>

          <ul className='text-muted-foreground space-y-1.5'>
            <li>
              <strong className='text-foreground/85 font-medium'>Nothing is stored.</strong> Your
              conversation lives in this tab only. Starting a new chat erases it for good, and there is no
              copy on the server.
            </li>
            <li>
              <strong className='text-foreground/85 font-medium'>It sees what you see.</strong> When it
              reads Hub records it does so with your permissions — never more.
            </li>
            <li>
              <strong className='text-foreground/85 font-medium'>It cannot change anything on its own.</strong>{' '}
              Creating a task, an event or a note needs your approval on a card first.
            </li>
          </ul>

          <p className='text-muted-foreground/80 border-border/60 border-t pt-2'>
            Powered by SYRIX. Built by Kabirr Kohli.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
