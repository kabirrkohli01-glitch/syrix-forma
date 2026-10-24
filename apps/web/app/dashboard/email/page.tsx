import type { Metadata } from 'next';
import { EMAIL_GUIDE } from '@/config/page-guides';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import PageContainer from '@/components/layout/page-container';
import { MailboxSearch } from '@/features/integrations/components/mailbox-search';
import { INTEGRATION_KEYS } from '@/lib/integrations/keys';
import { getIntegration } from '@/lib/integrations/settings';
import { canManageIntegrations } from '@/lib/permissions/integration-access';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';

export const metadata: Metadata = { title: 'Email' };

export default async function EmailPage() {
  const employee = await requireActiveEmployeeForPage();
  const integration = await getIntegration(INTEGRATION_KEYS.HOSTINGER_MAIL);
  const canSearch = canManageIntegrations(employee);
  const connected = integration?.enabled && integration.status === 'connected';

  return (
    <PageContainer
      pageTitle='Email'
      infoContent={EMAIL_GUIDE}
      pageDescription='Enquiry detection, search, and send/reply via Hostinger Mail, linked to clients and projects.'
    >
      <div className='flex flex-col gap-4'>
        <Card>
          <CardHeader>
            <CardTitle>Hostinger Mail</CardTitle>
            <CardDescription>
              {connected
                ? 'Connected — new enquiries are detected automatically and logged in Automations.'
                : "Not connected. Manual enquiry entry on the Automations page still works — email degrades independently, it never blocks the rest of SYRIX Forma."}
            </CardDescription>
          </CardHeader>
          <CardContent className='flex items-center gap-2'>
            <Badge variant={connected ? 'default' : 'outline'}>
              {integration?.status.replace('_', ' ') ?? 'not configured'}
            </Badge>
            {!connected && canSearch && (
              <Link href='/dashboard/settings/integrations' className='text-sm underline'>
                Connect it
              </Link>
            )}
            {!canSearch && (
              <span className='text-muted-foreground text-xs'>
                Connecting and searching the mailbox is managed by an ADMIN. Log an enquiry
                manually from the Automations page.
              </span>
            )}
          </CardContent>
        </Card>

        {canSearch && connected && (
          <Card>
            <CardHeader>
              <CardTitle>Search mailbox</CardTitle>
              <CardDescription>Live search against the connected mailbox — nothing here is a local copy.</CardDescription>
            </CardHeader>
            <CardContent>
              <MailboxSearch />
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
