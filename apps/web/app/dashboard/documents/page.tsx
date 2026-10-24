import type { Metadata } from 'next';
import PageContainer from '@/components/layout/page-container';
import { DOCUMENTS_GUIDE } from '@/config/page-guides';
import { DocumentList } from '@/features/documents/components/document-list';
import { LinkDocumentDialog } from '@/features/documents/components/link-document-dialog';
import { UploadDocumentDialog } from '@/features/documents/components/upload-document-dialog';
import { listAttachmentTargets, listDocuments } from '@/features/documents/utils/queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

export const metadata: Metadata = { title: 'Documents' };

export default async function DocumentsPage() {
  const caller = await requireActiveEmployeeForPage();

  // SECURITY_ADMIN has no business-data scope anywhere in the app, and documents are business
  // data. Gated here rather than relying on the list coming back empty, so the screen says why.
  if (scopeForBusinessData(caller.role) === 'none') {
    return (
      <PageContainer
        pageTitle='Documents'
        access={false}
        accessFallback={
          <div className='max-w-md text-center'>
            <p className='text-sm font-medium'>Documents are business data</p>
            <p className='text-muted-foreground mt-1 text-sm'>
              Your role covers sessions, the audit log and security events, and deliberately not
              clients, projects or the documents attached to them.
            </p>
          </div>
        }
      >
        {null}
      </PageContainer>
    );
  }

  const [documents, targets] = await Promise.all([
    listDocuments(caller),
    listAttachmentTargets(caller)
  ]);

  return (
    <PageContainer
      pageTitle='Documents'
      pageDescription='Files the Hub holds, and files it points at where they already live.'
      infoContent={DOCUMENTS_GUIDE}
      pageHeaderAction={
        <div className='flex flex-wrap gap-2'>
          <LinkDocumentDialog targets={targets} />
          <UploadDocumentDialog targets={targets} />
        </div>
      }
    >
      <DocumentList documents={documents} currentEmployeeId={caller.id} />
    </PageContainer>
  );
}
