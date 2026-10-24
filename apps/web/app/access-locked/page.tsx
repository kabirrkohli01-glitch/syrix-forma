import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignOutButton } from '@/features/auth/components/sign-out-button';
import { isCurrentlyLockedOut, minutesRemaining } from '@/lib/auth/lockout';
import { getEmployeeRow } from '@/lib/permissions/current-employee';
import { auth } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Account Locked' };

/** Roughly how long is left, in words somebody can act on rather than a timestamp. */
function describeWait(minutes: number): string {
  if (minutes <= 1) return 'less than a minute';
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'about an hour' : `about ${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'about a day' : `about ${days} days`;
}

/**
 * Where a locked-out account lands.
 *
 * It says how long is left and nothing about why the lock is the length it is. The escalation
 * ladder is deliberately not described here: telling someone which attempt they are on tells an
 * attacker exactly how much budget they have left before the cost rises.
 */
export default async function AccessLockedPage() {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const employee = await getEmployeeRow();
  if (!employee) redirect('/onboarding');

  // Sent back the moment it expires, rather than leaving somebody looking at a stale page and
  // assuming they are still shut out.
  if (!isCurrentlyLockedOut(employee)) redirect('/dashboard');

  return (
    <div className='flex min-h-svh items-center justify-center p-6'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>Account temporarily locked</CardTitle>
          <CardDescription>
            This account was locked after repeated failed sign-in attempts. You can try again in{' '}
            {describeWait(minutesRemaining(employee))}.
            <br />
            <br />
            If that was not you, tell a SYRIX Forma administrator — they have already been notified
            that this happened, and can help you reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
