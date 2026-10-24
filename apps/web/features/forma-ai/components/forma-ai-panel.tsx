'use client';

/* The side-panel mount, and the header button that opens it.
 *
 * Two mounts, one conversation: this panel and `/dashboard/forma-ai` render the
 * same `ConversationView` against the same provider, so a question asked in the
 * panel is already there on the tab. Neither owns the state.
 *
 * A sheet rather than a resizable split: the panel overlays the page it is asked
 * about instead of reflowing it, which keeps the record the user is reading in
 * the same place while they ask about it.
 */

import React, { createContext, useContext, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icons } from '@/components/icons';

import { ConversationView } from './conversation-view';
import { FormaAiMark } from './forma-ai-mark';

interface PanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const PanelContext = createContext<PanelState | null>(null);

export function FormaAiPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);

  return (
    <PanelContext.Provider value={value}>
      {children}
      {/* Non-modal, no backdrop: this panel is meant to be read and used
          alongside the page it was opened from, not instead of it. A modal
          sheet traps focus and blocks every click behind it, which defeats
          the entire point of putting the assistant on the side rather than
          its own tab — it becomes a second full-screen mode wearing a
          sidebar's width. */}
      <Sheet open={open} onOpenChange={setOpen} modal={false}>
        <SheetContent
          side='right'
          overlay={false}
          className='flex w-full flex-col gap-0 border-l p-0 shadow-2xl sm:max-w-lg'
        >
          <SheetHeader className='px-4 py-3'>
            <SheetTitle className='flex items-center gap-2 text-sm'>
              <FormaAiMark size={22} />
              SYRIX AI
            </SheetTitle>
            <SheetDescription className='sr-only'>
              Research assistant. Nothing asked here is stored.
            </SheetDescription>
          </SheetHeader>
          {/* Compact: the hero drops a size, the suggested openers halve and the
              capability list goes to one column. At panel width the full set
              wraps into ragged lines and reads as clutter. */}
          <ConversationView className='min-h-0 flex-1' compact />
        </SheetContent>
      </Sheet>
    </PanelContext.Provider>
  );
}

function usePanel(): PanelState {
  const context = useContext(PanelContext);
  if (!context) throw new Error('useFormaAiPanel must be used inside a FormaAiPanelProvider.');
  return context;
}

export function FormaAiPanelTrigger() {
  const { setOpen } = usePanel();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            onClick={() => setOpen(true)}
            aria-label='Open SYRIX AI'
            className='size-8'
          >
            <Icons.sparkles className='size-4' />
          </Button>
        }
      />
      <TooltipContent side='bottom'>SYRIX AI</TooltipContent>
    </Tooltip>
  );
}
