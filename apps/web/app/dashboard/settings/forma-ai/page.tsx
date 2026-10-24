import type { Metadata } from 'next';

import PageContainer from '@/components/layout/page-container';
import { AI_SETTINGS_GUIDE } from '@/config/page-guides';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { getAiSettings } from '@/features/forma-ai/actions';
import { AiSettingsForm } from '@/features/forma-ai/components/ai-settings-form';

export const metadata: Metadata = { title: 'SYRIX AI settings' };

/* No role gate. These are one person's own preferences about their own
   assistant — every active employee has them, and they grant nothing: with Hub
   access switched on, the context broker still authorises every read as this
   employee and every write still passes the Hub's own checks. */
export default async function FormaAiSettingsPage() {
  await requireActiveEmployeeForPage();
  const settings = await getAiSettings();

  return (
    <PageContainer
      pageTitle='SYRIX AI'
      pageDescription='How the assistant answers you, and what it is allowed to reach.'
      infoContent={AI_SETTINGS_GUIDE}
    >
      <div className='max-w-3xl'>
        <AiSettingsForm initial={settings} />
      </div>
    </PageContainer>
  );
}
