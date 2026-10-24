'use client';

/* What SYRIX AI can actually do, said on the screen rather than left to be
 * discovered.
 *
 * The empty state used to carry four chips — "Trusted sources", "Citations
 * included" — which describe how it behaves, not what to ask it for. Somebody
 * opening this for the first time still had to guess whether it could see their
 * calendar, whether it would write an email, and whether anything they typed was
 * being kept. Those are the questions people actually have, and none of them
 * were answered anywhere on the screen.
 *
 * EVERY LINE HERE NAMES SOMETHING THE CODE DOES, and that is the rule for adding
 * one. Each entry below maps to a route in `lib/ai/pipeline/route.ts` or to a
 * guarantee the pipeline keeps: the approval card cannot be bypassed, the draft
 * route has no send path, the server writes no transcript. A capability list
 * that overstates is worse than none — it teaches people to rely on something
 * that is not there.
 */

import React from 'react';

import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';

interface Capability {
  icon: keyof typeof Icons;
  title: string;
  detail: string;
}

const CAPABILITIES: Capability[] = [
  {
    icon: 'shield',
    title: 'Researches the rules',
    detail: 'GOV.UK and legislation first, third parties after. Every figure carries the page it came from and the date it applies.'
  },
  {
    icon: 'dashboard',
    title: 'Reads your Hub',
    detail: 'Tasks, calendar, clients, projects and people — only ever the records your role can already open.'
  },
  {
    icon: 'circleCheck',
    title: 'Acts on your say-so',
    detail: 'A task, an event or a client note is put in front of you on a card with the real details. Nothing is written until you approve it.'
  },
  {
    icon: 'mail',
    title: 'Drafts emails',
    detail: 'Subject, recipient and body, editable and ready to copy. It never sends anything.'
  },
  {
    icon: 'adjustments',
    title: 'Works things out',
    detail: 'Billable hours, fee targets, options weighed and ranked. No sources where no page would settle it, and it says so.'
  },
  {
    icon: 'paperclip',
    title: 'Reads what you attach',
    detail: 'PDFs, screenshots and notes — up to four per question. Ask about a refusal letter by sending it.'
  },
  {
    icon: 'clock',
    title: 'Follows the news',
    detail: 'GOV.UK, the Home Office, BBC and other named publishers, each item with the time that publisher gave it.'
  },
  {
    icon: 'lock',
    title: 'Keeps nothing',
    detail: 'The conversation lives in this tab. A new chat erases it for good, and no copy is written on the server.'
  }
];

/** Openers that show the range rather than the same question four times. */
const SUGGESTIONS = [
  'What is the current Skilled Worker minimum salary?',
  'Draft an email telling a client their ILR application has been submitted',
  'What is on my calendar this week?',
  'Any UK immigration news in the last week?',
  'Compare the Skilled Worker and Global Talent routes for a senior engineer',
  'My client has 210 days absent over 9 years — how many more can she be away?'
];

export function Suggestions({ onPick, compact }: { onPick: (text: string) => void; compact?: boolean }) {
  return (
    <ul className='flex flex-wrap justify-center gap-1.5'>
      {SUGGESTIONS.slice(0, compact ? 3 : 6).map((suggestion) => (
        <li key={suggestion}>
          <button
            type='button'
            onClick={() => onPick(suggestion)}
            className='border-border/70 text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/50 focus-visible:ring-ring max-w-full truncate rounded-full border px-3 py-1.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none'
          >
            {suggestion}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Capabilities({ compact }: { compact?: boolean }) {
  const shown = compact ? CAPABILITIES.slice(0, 4) : CAPABILITIES;

  return (
    <section className='w-full'>
      <h3 className='text-muted-foreground/80 mb-3 text-center text-[0.7rem] font-medium tracking-wide uppercase'>
        What it can do
      </h3>

      <ul className={cn('grid gap-x-6 gap-y-3 text-left', compact ? 'grid-cols-1' : 'sm:grid-cols-2')}>
        {shown.map((capability) => {
          const Icon = Icons[capability.icon];

          return (
            <li key={capability.title} className='flex items-start gap-2.5'>
              <Icon
                className='mt-0.5 size-4 shrink-0 text-[color:var(--ai-amber)] opacity-80'
                aria-hidden
              />
              <div className='min-w-0'>
                <p className='text-foreground/90 text-xs font-medium'>{capability.title}</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>{capability.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
