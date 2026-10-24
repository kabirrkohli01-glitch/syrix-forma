import type { Metadata } from 'next';
import { HR_REPORTS_GUIDE } from '@/config/page-guides';
import PageContainer from '@/components/layout/page-container';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import {
  BurnoutList,
  DemographicList,
  LeaveUsageList,
  PayrollExportCard,
  StatTile
} from '@/features/hr/components/report-panels';
import {
  countEmployeesWithoutManager,
  currentReportingYear,
  getAbsenceReport,
  getBurnoutSignals,
  getContractTypeBreakdown,
  getHeadcountReport,
  getLeaveReport
} from '@/features/hr/utils/report-queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { canExportPayroll, canViewHrReports } from '@/lib/permissions/hr-access';

export const metadata: Metadata = { title: 'HR Reports' };

export default async function HrReportsPage() {
  const caller = await requireActiveEmployeeForPage();

  // Aggregate HR reporting is HR-only. A finance user can still reach the payroll export
  // below, which is why the page itself allows either and each section checks its own.
  const canSeeReports = canViewHrReports(caller);
  const canExport = canExportPayroll(caller);

  if (!canSeeReports && !canExport) {
    return (
      <PageContainer pageTitle='HR Reports' access={false}>
        {null}
      </PageContainer>
    );
  }

  const year = await currentReportingYear();

  const [headcount, absence, leave, demographics, burnout, withoutManager] = canSeeReports
    ? await Promise.all([
        getHeadcountReport(year),
        getAbsenceReport(year),
        getLeaveReport(year),
        getContractTypeBreakdown(),
        getBurnoutSignals(year),
        countEmployeesWithoutManager()
      ])
    : [null, null, [], [], [], 0];

  return (
    <PageContainer
      pageTitle='HR Reports'
      infoContent={HR_REPORTS_GUIDE}
      pageDescription={`Leave year ${year.start} to ${year.end}. Figures marked as rates are approximations, not exact counts.`}
    >
      <div className='flex flex-col gap-5'>
        <HrTabs />

        {canSeeReports && headcount && absence && (
          <>
            <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
              <StatTile label='Active employees' value={String(headcount.active)} />
              <StatTile
                label='Started this year'
                value={String(headcount.startedThisYear)}
                hint={headcount.pending > 0 ? `${headcount.pending} pending approval` : undefined}
              />
              <StatTile
                label='Turnover'
                value={headcount.turnoverPercent === null ? '—' : `${headcount.turnoverPercent}%`}
                hint={`${headcount.leftThisYear} left`}
              />
              <StatTile
                label='Absence rate'
                value={absence.absenceRatePercent === null ? '—' : `${absence.absenceRatePercent}%`}
                hint={`${absence.totalDaysLost} days lost`}
              />
            </div>

            {withoutManager > 0 && (
              <p className='text-muted-foreground px-1 text-sm'>
                {withoutManager} active {withoutManager === 1 ? 'employee has' : 'employees have'}{' '}
                no line manager set, so their leave and timesheets route to HR rather than to a
                manager.
              </p>
            )}

            <BurnoutList signals={burnout} />

            <div className='grid gap-5 lg:grid-cols-2'>
              <LeaveUsageList rows={leave} />
              <DemographicList rows={demographics} />
            </div>
          </>
        )}

        {canExport && <PayrollExportCard defaultFrom={year.start} defaultTo={year.end} />}
      </div>
    </PageContainer>
  );
}
