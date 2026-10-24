'use client';

import { Button } from '@/components/ui/button';
import { useClerk } from '@clerk/nextjs';

export function SignOutButton() {
  const { signOut } = useClerk();
  return (
    <Button variant='outline' onClick={() => signOut({ redirectUrl: '/auth/sign-in' })}>
      Sign out
    </Button>
  );
}
