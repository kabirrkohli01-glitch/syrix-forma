import type { Metadata } from 'next';
import { HR_SAFETY_GUIDE } from '@/config/page-guides';
import PageContainer from '@/components/layout/page-container';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import {
  IncidentLog,
  ReportIncidentDialog,
  RiskAssessmentList,
  SafetyRoleList
} from '@/features/hr/components/growth-panels';
import {
  listGrowthSubjects,
  listIncidents,
  listRiskAssessments,
  listSafetyRoles
} from '@/features/hr/utils/growth-queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { hrScopeFor } from '@/lib/permissions/hr-access';

export const metadata: Metadata = { title: 'Health and Safety' };

export default async function SafetyPage() {
  const caller = await requireActiveEmployeeForPage();

  if (hrScopeFor(caller) === 'none') {
    return (
      <PageContainer pageTitle='Health and Safety' access={false}>
        {null}
      </PageContainer>
    );
  }

  const [incidents, assessments, roles, subjects] = await Promise.all([
    listIncidents(caller),
    listRiskAssessments(),
    listSafetyRoles(),
    listGrowthSubjects(caller)
  ]);

  return (
    <PageContainer
      pageTitle='Health and Safety'
      infoContent={HR_SAFETY_GUIDE}
      pageDescription='Report anything, see what was done about it, and check the controls in place.'
      pageHeaderAction={<ReportIncidentDialog subjects={subjects} />}
    >
      <div className='flex flex-col gap-5'>
        <HrTabs />
        <IncidentLog incidents={incidents} />
        <div className='grid gap-5 lg:grid-cols-2'>
          <RiskAssessmentList
            assessments={assessments.map((assessment) => ({
              id: assessment.id,
              title: assessment.title,
              location: assessment.location,
              level: assessment.level,
              reviewDueOn: assessment.reviewDueOn
            }))}
          />
          <SafetyRoleList roles={roles} />
        </div>
      </div>
    </PageContainer>
  );
}
