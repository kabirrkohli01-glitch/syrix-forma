'use client';

/* The full-tab frame around the shared conversation.
 *
 * ONE SURFACE, NOT A PANEL INSIDE A PAGE. This previously drew a bordered card
 * and dropped the conversation inside it, which put a rounded rectangle on a
 * page that was already a rounded rectangle — a box inside a box, with the
 * reading column narrower than it needed to be for no reason anybody could see.
 * The conversation now sits directly on the page background and runs to its
 * edges. The only bordered thing left on this screen is the composer, which
 * earns its border by being an input.
 *
 * Fills the window: `flex-1` with `min-h-0` rather than `h-full`, because the
 * parent's height comes from the flex column and a percentage height against an
 * auto-sized parent resolves to nothing.
 */

import React from 'react';

import { Button } from '@/components/ui/button';
import { InfoButton } from '@/components/ui/info-button';
import { Icons } from '@/components/icons';
import { FORMA_AI_GUIDE } from '@/config/page-guides';

import { useConversation } from '../store/conversation';
import { ConversationView, ModeSwitcher } from './conversation-view';
import { FormaAiMark } from './forma-ai-mark';

export function FormaAiTab() {
  const { mode, setMode, busy, turns, newChat } = useConversation();

  return (
    <div className='forma-ai flex min-h-0 w-full flex-1 flex-col'>
      <div className='border-border/40 flex flex-wrap items-center justify-between gap-3 border-b pb-3'>
        <div className='flex items-center gap-3'>
          <FormaAiMark size={44} />
          <div>
            <h1 className='text-xl font-semibold tracking-tight'>SYRIX AI</h1>
            <p className='text-muted-foreground text-xs'>
              Your research assistant, powered by trusted sources.
            </p>
          </div>
        </div>

        {/* Wraps for the same reason the row above it does. The mode switcher, the guide button and
            New chat come to about 470px together, and as an unwrapped row of unshrinkable buttons
            they extended past a phone viewport and made the page scroll sideways. */}
        <div className='flex flex-wrap items-center gap-2'>
          <ModeSwitcher mode={mode} onChange={setMode} disabled={busy} />
          {/* This screen draws its own heading rather than PageContainer's, so the guide button
              that normally sits beside a page title belongs here instead. */}
          <InfoButton content={FORMA_AI_GUIDE} label='How this works' className='text-xs' />
          <Button
            variant='ghost'
            size='sm'
            onClick={newChat}
            disabled={!turns.length}
            className='text-muted-foreground hover:text-foreground gap-1.5 text-xs'
          >
            <Icons.add className='size-3.5' aria-hidden />
            New chat
          </Button>
        </div>
      </div>

      <ConversationView className='min-h-0 flex-1' showModeBar={false} />
    </div>
  );
}
