import { SignIn as ClerkSignInForm } from '@clerk/nextjs';
import { Metadata } from 'next';
import { AuthShell } from './auth-shell';

export const metadata: Metadata = {
  title: 'Sign in'
};

export default function SignInViewPage() {
  return (
    <AuthShell tagline='Internal use only.'>
      <ClerkSignInForm appearance={{ options: { logoImageUrl: '/forma-badge.png' } }} />
    </AuthShell>
  );
}
