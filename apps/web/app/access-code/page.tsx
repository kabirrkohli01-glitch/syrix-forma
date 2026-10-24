import { AccessCodeForm } from '@/features/auth/components/access-code-form';
import { AuthShell } from '@/features/auth/components/auth-shell';
import { currentLockSeconds, hasAccessSession } from '@/features/auth/access-code-actions';
import { accessCodeConfig } from '@/lib/auth/access-code-config';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Access code',
  robots: { index: false, follow: false }
};

// Nothing on this screen may be cached: what it renders depends on whether this particular
// requester already holds a session and whether they are locked out.
export const dynamic = 'force-dynamic';

/**
 * The door, when this deployment is running on a shared access code instead of sign-in.
 *
 * Returns a 404 on any other deployment rather than rendering a disabled form: a route that
 * announces "a code would work here, but not on this server" is an invitation to try the other
 * servers, and there is no reason for it to exist where it does nothing.
 */
export default async function AccessCodePage() {
  const config = accessCodeConfig();
  if (!config) notFound();

  if (await hasAccessSession()) redirect('/dashboard');

  return (
    <AuthShell tagline='Internal use only.'>
      <div className='w-full text-center'>
        <h1 className='text-2xl font-semibold tracking-tight'>Enter the access code</h1>
        <p className='text-muted-foreground mt-2 text-sm'>
          This preview of SYRIX Forma opens with a code rather than an account.
        </p>
      </div>
      <AccessCodeForm
        codeLength={config.code.length}
        initialLockSeconds={await currentLockSeconds()}
      />
    </AuthShell>
  );
}
