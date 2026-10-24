import { accessCodeModeEnabled } from '@/lib/auth/access-code-config';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function Page() {
  // On a shared access code there is no Clerk session to consult, and proxy.ts has already
  // decided: an unauthorised request never reaches this file, so anything that does is through
  // the gate and belongs in the dashboard.
  if (accessCodeModeEnabled()) {
    redirect('/dashboard');
  }

  const { userId } = await auth();

  if (!userId) {
    return redirect('/auth/sign-in');
  } else {
    redirect('/dashboard');
  }
}
