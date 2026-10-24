'use client';

import { Button } from '@/components/ui/button';
import { signOutOtherSessions } from '@/features/profile/actions';
import { useTransition } from 'react';
import { toast } from 'sonner';

export function SignOutOtherSessionsButton() {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        await signOutOtherSessions();
        toast.success('Signed out of all other sessions');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to sign out other sessions');
      }
    });
  }

  return (
    <Button variant='outline' onClick={handleClick} disabled={isPending}>
      Log out everywhere else
    </Button>
  );
}
