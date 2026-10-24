import type { Metadata } from 'next';
import { HR_HIRING_GUIDE } from '@/config/page-guides';
import PageContainer from '@/components/layout/page-container';
import { ApplicationList, VacancyList } from '@/features/hr/components/growth-panels';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import { listApplications, listVacancies } from '@/features/hr/utils/growth-queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import {
  canConvertApplicantToEmployee,
  canManageVacancies,
  hrScopeFor
} from '@/lib/permissions/hr-access';

export const metadata: Metadata = { title: 'Hiring' };

export default async function HiringPage() {
  const caller = await requireActiveEmployeeForPage();

  if (hrScopeFor(caller) === 'none') {
    return (
      <PageContainer pageTitle='Hiring' access={false}>
        {null}
      </PageContainer>
    );
  }

  const [vacancies, applications] = await Promise.all([
    listVacancies(caller),
    listApplications(caller)
  ]);

  const canManage = canManageVacancies(caller);
  // Only vacancies the caller can actually add candidates to — HR's, or ones they are the
  // hiring manager for. Offering the rest in the picker would produce a refusal on submit.
  const manageableVacancies = vacancies.filter(
    (vacancy) => canManage || vacancy.hiringManagerEmployeeId === caller.id
  );

  return (
    <PageContainer
      pageTitle='Hiring'
      infoContent={HR_HIRING_GUIDE}
      pageDescription={
        canManage
          ? 'Open roles, candidates, and the hand-off from hired to employee record.'
          : 'Open roles across the organisation, and candidates for the ones you are hiring for.'
      }
    >
      <div className='flex flex-col gap-5'>
        <HrTabs />
        <VacancyList
          vacancies={vacancies.map((vacancy) => ({
            id: vacancy.id,
            title: vacancy.title,
            team: vacancy.team,
            status: vacancy.status,
            closesOn: vacancy.closesOn
          }))}
          canManage={canManage}
        />
        <ApplicationList
          applications={applications}
          vacancies={manageableVacancies.map((v) => ({ id: v.id, title: v.title }))}
          canConvert={canConvertApplicantToEmployee(caller)}
        />
      </div>
    </PageContainer>
  );
}
