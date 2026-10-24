import type { Metadata } from 'next';
import PageContainer from '@/components/layout/page-container';
import { HR_SETTINGS_GUIDE } from '@/config/page-guides';
import { AllowancesPanel } from '@/features/hr/components/allowances-panel';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import { LeavePolicyForm } from '@/features/hr/components/leave-policy-form';
import { LeaveTypesPanel } from '@/features/hr/components/leave-types-panel';
import { PublicHolidaysPanel } from '@/features/hr/components/public-holidays-panel';
import { currentLeaveYear, getLeaveSettings } from '@/features/hr/utils/leave-queries';
import {
  listAllLeaveTypes,
  listLeaveAllowances,
  listPublicHolidays,
  toDays
} from '@/features/hr/utils/settings-queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { canManageHrSettings } from '@/lib/permissions/hr-access';

export const metadata: Metadata = { title: 'HR Settings' };

function formatLeaveYearStart(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

export default async function HrSettingsPage() {
  const caller = await requireActiveEmployeeForPage();

  // Not notFound(): unlike Settings → Access Control, the existence of HR settings is not
  // itself sensitive, and a colleague who followed a link here deserves to be told what would
  // let them in rather than shown a 404 that reads like a broken app.
  if (!canManageHrSettings(caller)) {
    return (
      <PageContainer
        pageTitle='HR settings'
        pageDescription='Company leave policy, leave types, allowances and public holidays.'
      >
        <div className='flex flex-col gap-5'>
          <HrTabs />
          <div className='bg-card ring-foreground/10 rounded-2xl p-4 ring-1'>
            <p className='text-sm font-medium'>You do not have HR administration</p>
            <p className='text-muted-foreground mt-1 text-sm'>
              These settings decide every employee&apos;s entitlement, so they are limited to HR.
              An administrator grants HR administration on your record in Settings → People &amp;
              Access; it sits alongside your existing role rather than replacing it.
            </p>
          </div>
        </div>
      </PageContainer>
    );
  }

  const year = await currentLeaveYear();

  const [settings, leaveTypes, allowances, holidays] = await Promise.all([
    getLeaveSettings(),
    listAllLeaveTypes(caller),
    listLeaveAllowances(caller, year),
    listPublicHolidays(caller, year)
  ]);

  const leaveYearLabel = formatLeaveYearStart(year.start);

  return (
    <PageContainer
      pageTitle='HR settings'
      pageDescription={`Company leave policy, leave types, allowances and public holidays. Current leave year starts ${leaveYearLabel}.`}
      infoContent={HR_SETTINGS_GUIDE}
    >
      <div className='flex flex-col gap-6'>
        <HrTabs />

        <LeavePolicyForm
          initial={{
            leaveYearStartMonth: settings.leaveYearStartMonth,
            leaveYearStartDay: settings.leaveYearStartDay,
            defaultEntitlementDays: toDays(settings.defaultEntitlementHalfDays),
            carryOverMaxDays: toDays(settings.carryOverMaxHalfDays),
            carryOverExpiryMonths: settings.carryOverExpiryMonths,
            allowNegativeBalance: settings.allowNegativeBalance
          }}
        />

        <LeaveTypesPanel types={leaveTypes} />

        <AllowancesPanel
          rows={allowances}
          leaveYearStart={year.start}
          leaveYearLabel={leaveYearLabel}
          defaultEntitlementDays={toDays(settings.defaultEntitlementHalfDays)}
        />

        <PublicHolidaysPanel
          holidays={holidays}
          leaveYearStart={year.start}
          leaveYearLabel={leaveYearLabel}
        />
      </div>
    </PageContainer>
  );
}
