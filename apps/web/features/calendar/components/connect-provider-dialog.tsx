'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';

// Deliberately not a real connection flow — Google/Outlook Calendar sync needs an OAuth app that
// hasn't been configured yet (deferred by request; see the build plan Phase 4 and
// docs/data-model.md). This button exists so the option is visible in the product rather than
// silently missing, but it says plainly that nothing happens yet — engineering rule 7 bans
// faking a working integration.
export function ConnectProviderDialog({ provider }: { provider: 'Google' | 'Outlook' }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant='outline' size='sm' />}>Connect {provider} Calendar</DialogTrigger>
      <DialogContent className='sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>{provider} Calendar isn&apos;t connected yet</DialogTitle>
          <DialogDescription>
            This needs a real {provider} OAuth application set up by an ADMIN before it can sync —
            that hasn&apos;t happened yet, so this button doesn&apos;t do anything real yet. Events you
            create here in SYRIX Forma work fully on their own in the meantime; {provider} sync would
            add a second source for the same calendar, not replace this one.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
