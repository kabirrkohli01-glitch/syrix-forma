import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignOutButton } from '@/features/auth/components/sign-out-button';
import { getEmployeeRow } from '@/lib/permissions/current-employee';
import { auth } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Access Disabled' };

export default async function AccessDisabledPage() {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const employee = await getEmployeeRow();
  if (employee?.status === 'active') redirect('/dashboard');
  if (!employee || employee.status === 'pending') redirect('/onboarding');

  return (
    <div className='flex min-h-svh items-center justify-center p-6'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>Access disabled</CardTitle>
          <CardDescription>
            Your SYRIX Forma access has been disabled by an administrator. If you believe this is a
            mistake, contact your manager or a SYRIX Forma administrator directly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
