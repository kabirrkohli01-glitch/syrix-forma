import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignOutButton } from '@/features/auth/components/sign-out-button';
import { getEmployeeRow } from '@/lib/permissions/current-employee';
import { auth } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Access Refused' };

/**
 * Where a refused request lands. Separate from /access-disabled because the two say different
 * things to the person reading them: a disabled account belonged to someone who worked here, and
 * "contact your manager" is useful advice. A refused request is usually someone who has no
 * business here at all, and the page deliberately names no route back in.
 */
export default async function AccessRefusedPage() {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const employee = await getEmployeeRow();
  if (employee?.status === 'active') redirect('/dashboard');
  if (!employee || employee.status === 'pending') redirect('/onboarding');
  if (employee.status === 'disabled') redirect('/access-disabled');

  return (
    <div className='flex min-h-svh items-center justify-center p-6'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>Access refused</CardTitle>
          <CardDescription>
            This account has not been granted access to SYRIX Forma. If you work at the organisation and reached
            this page by mistake, speak to a SYRIX Forma administrator in person.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
