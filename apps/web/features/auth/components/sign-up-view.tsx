import { SignUp as ClerkSignUpForm } from '@clerk/nextjs';
import { Metadata } from 'next';
import { AuthShell } from './auth-shell';

export const metadata: Metadata = {
  title: 'Sign up'
};

export default function SignUpViewPage() {
  return (
    <AuthShell tagline='Internal use only.'>
      <ClerkSignUpForm appearance={{ options: { logoImageUrl: '/forma-badge.png' } }} />
    </AuthShell>
  );
}
