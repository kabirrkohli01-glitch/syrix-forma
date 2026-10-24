import type { Metadata } from 'next';

import PageContainer from '@/components/layout/page-container';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { FormaAiTab } from '@/features/forma-ai/components/forma-ai-tab';

export const metadata: Metadata = { title: 'SYRIX AI' };

/* The full-tab mount. Renders the same conversation as the header side panel —
   the provider lives in the dashboard layout, above both — so a question asked
   in the panel is already here, mid-stream if it is still running.

   NO `pageTitle`. Every other screen lets PageContainer draw its heading, but
   this one draws its own with the assistant's mark beside it, and passing both
   put "SYRIX AI" on the page twice with a rule between them.

   No role scoping: the assistant reads Hub data through the context broker,
   which authorises every read as the requesting employee and therefore returns
   nothing for someone with no access. A role gate here would be a second, less
   precise copy of a check that already happens in the right place. */
export default async function FormaAiPage() {
  await requireActiveEmployeeForPage();

  return (
    <PageContainer>
      <FormaAiTab />
    </PageContainer>
  );
}
