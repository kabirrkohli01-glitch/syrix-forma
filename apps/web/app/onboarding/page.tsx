import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignOutButton } from '@/features/auth/components/sign-out-button';
import { recordSignIn } from '@/lib/auth/sign-in-events';
import { getEmployeeRow } from '@/lib/permissions/current-employee';
import { auth, currentUser } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Waiting for approval' };

export default async function OnboardingPage() {
  const { userId, sessionId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const employee = await getEmployeeRow();
  if (employee?.status === 'active') redirect('/dashboard');
  if (employee?.status === 'disabled') redirect('/access-disabled');
  if (employee?.status === 'rejected') redirect('/access-refused');

  // Recorded here as well as in the dashboard layout: someone who has just signed up lands
  // straight on this page and may never request /dashboard at all, and a request for access that
  // reached nobody is the exact failure this is meant to prevent. Recording the same session
  // twice is a no-op — see the unique constraint the recorder relies on.
  if (employee && sessionId) await recordSignIn(employee, sessionId);

  const user = await currentUser();

  return (
    <div className='flex min-h-svh items-center justify-center p-6'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>Your request has been sent</CardTitle>
          <CardDescription>
            We&apos;ve asked a SYRIX Forma administrator to approve access for{' '}
            <strong className='text-foreground font-medium'>
              {user?.primaryEmailAddress?.emailAddress ?? 'your account'}
            </strong>
            .
            <br />
            <br />
            They&apos;ve been notified and will review it. There&apos;s nothing you need to do —
            sign in again once they&apos;ve approved you and your own account will be waiting,
            with your work in it. If it&apos;s urgent, ask them directly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
