import type { Metadata } from 'next';
import { HR_ABSENCE_GUIDE } from '@/config/page-guides';
import PageContainer from '@/components/layout/page-container';
import {
  AbsenceList,
  AbsenceTriggerList,
  RecordAbsenceDialog
} from '@/features/hr/components/absence-panels';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import {
  listAbsenceRecords,
  listAbsenceSubjects,
  listAbsenceTriggers
} from '@/features/hr/utils/absence-queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { hrScopeFor } from '@/lib/permissions/hr-access';

export const metadata: Metadata = { title: 'Absence' };

export default async function AbsencePage() {
  const caller = await requireActiveEmployeeForPage();
  const scope = hrScopeFor(caller);

  if (scope === 'none') {
    return (
      <PageContainer pageTitle='Absence' access={false}>
        {null}
      </PageContainer>
    );
  }

  const [records, triggers, subjects] = await Promise.all([
    listAbsenceRecords(caller),
    listAbsenceTriggers(caller),
    listAbsenceSubjects(caller)
  ]);

  // Anyone with a report, and HR, can close an absence or log a return-to-work interview.
  // Somebody with neither is looking at their own record only, and has nothing to manage.
  const canManage = scope === 'all' || subjects.some((s) => s.isReport);

  return (
    <PageContainer
      pageTitle='Absence'
      infoContent={HR_ABSENCE_GUIDE}
      pageDescription={
        scope === 'all'
          ? 'Sickness and unplanned absence across the company, with the patterns worth a conversation.'
          : 'Your own absence, and that of the people who report to you.'
      }
      pageHeaderAction={
        <RecordAbsenceDialog
          subjects={subjects.map((s) => ({ id: s.id, name: s.name, isSelf: s.isSelf }))}
          canRecordForOthers={canManage}
        />
      }
    >
      <div className='flex flex-col gap-5'>
        <HrTabs />
        <AbsenceTriggerList triggers={triggers} />
        <AbsenceList records={records} canManage={canManage} />
      </div>
    </PageContainer>
  );
}
