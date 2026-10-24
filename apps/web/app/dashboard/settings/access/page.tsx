import PageContainer from '@/components/layout/page-container';
import { EmployeeAccessTable } from '@/features/access-control/components/employee-access-table';
import { describeDevice, latestSignInByEmployee } from '@/lib/auth/sign-in-events';
import { db } from '@/lib/db/client';
import { resolveDisplayName } from '@/lib/db/display-name';
import { employees } from '@/lib/db/schema';
import { ForbiddenError, requireRole } from '@/lib/permissions/current-employee';
import { ACCESS_CONTROL_GUIDE } from '@/config/page-guides';
import { desc } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'People & Access' };

export default async function AccessControlPage() {
  // Server-side gate — this is the real control. The sidebar hiding this link for non-admins
  // is a UX nicety only, never the enforcement (engineering rule 10). 404, not a 403 page, so
  // a non-admin gets no confirmation this route even exists.
  let admin;
  try {
    admin = await requireRole('ADMIN');
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const rows = await db.select().from(employees).orderBy(desc(employees.createdAt));

  // Deciding whether to let someone in means seeing where the request came from, not only that it
  // exists. Fetched for the rows already on this page rather than queried per card.
  const signIns = await latestSignInByEmployee(rows.map((r) => r.id));

  return (
    <PageContainer
      pageTitle='People & Access'
      pageDescription='Who can sign in, what each of them can reach, and who is waiting to be let in.'
      infoContent={ACCESS_CONTROL_GUIDE}
    >
      <EmployeeAccessTable
        employees={rows.map((r) => {
          const seen = signIns.get(r.id);
          return {
            id: r.id,
            name: resolveDisplayName(r),
            accountName: r.name,
            email: r.email,
            role: r.role,
            team: r.team,
            status: r.status,
            hrAdmin: r.hrAdmin,
            financeAccess: r.financeAccess,
            lastSignIn: seen
              ? {
                  when: seen.createdAt.toLocaleString('en-GB', {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                  }),
                  where: [describeDevice(seen.userAgent), seen.ipAddress, seen.country]
                    .filter(Boolean)
                    .join(' · ')
                }
              : null
          };
        })}
        currentEmployeeId={admin.id}
      />
    </PageContainer>
  );
}
