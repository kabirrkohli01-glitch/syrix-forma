import type { Metadata } from 'next';
import { HR_DOCUMENTS_GUIDE } from '@/config/page-guides';
import PageContainer from '@/components/layout/page-container';
import { DocumentList, UploadDocumentDialog } from '@/features/hr/components/document-panels';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import { listHrDocuments, listPerformanceSubjects } from '@/features/hr/utils/performance-queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { canManageHrDocuments, hrScopeFor } from '@/lib/permissions/hr-access';

export const metadata: Metadata = { title: 'HR Documents' };

export default async function HrDocumentsPage() {
  const caller = await requireActiveEmployeeForPage();

  if (hrScopeFor(caller) === 'none') {
    return (
      <PageContainer pageTitle='Documents' access={false}>
        {null}
      </PageContainer>
    );
  }

  const canManage = canManageHrDocuments(caller);
  const [documents, subjects] = await Promise.all([
    listHrDocuments(caller),
    canManage ? listPerformanceSubjects(caller) : Promise.resolve([])
  ]);

  return (
    <PageContainer
      pageTitle='Documents'
      infoContent={HR_DOCUMENTS_GUIDE}
      pageDescription='Company policies everyone can read, and the documents on your own record.'
      pageHeaderAction={
        canManage ? (
          <UploadDocumentDialog
            employeeOptions={subjects.map((s) => ({ id: s.id, name: s.name }))}
          />
        ) : undefined
      }
    >
      <div className='flex flex-col gap-5'>
        <HrTabs />
        <DocumentList documents={documents} />
      </div>
    </PageContainer>
  );
}
