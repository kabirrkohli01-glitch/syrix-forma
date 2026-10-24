import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { INTEGRATIONS_GUIDE } from '@/config/page-guides';
import { DeadLetterList } from '@/features/integrations/components/dead-letter-list';
import { HostingerMailSettingsForm } from '@/features/integrations/components/hostinger-mail-settings-form';
import { IntegrationStatusCard } from '@/features/integrations/components/integration-status-card';
import { db } from '@/lib/db/client';
import { employees, integrations } from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { eq } from 'drizzle-orm';
import { listUnresolvedDeadLetters } from '@/lib/integrations/dead-letter';
import { INTEGRATION_KEYS } from '@/lib/integrations/keys';
import { ForbiddenError, requireRole } from '@/lib/permissions/current-employee';

export const metadata: Metadata = { title: 'Integrations' };

export default async function IntegrationsPage() {
  // Same 404-not-403 gate as Access Control — a non-admin gets no confirmation this route
  // exists (engineering rule 10).
  try {
    await requireRole('ADMIN');
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [rows, activeEmployees, deadLetters] = await Promise.all([
    db.select().from(integrations),
    db.select({ id: employees.id, name: employeeDisplayName }).from(employees).where(eq(employees.status, 'active')),
    listUnresolvedDeadLetters()
  ]);

  const hostinger = rows.find((r) => r.key === INTEGRATION_KEYS.HOSTINGER_MAIL);
  const microsoft365 = rows.find((r) => r.key === INTEGRATION_KEYS.MICROSOFT_365);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const webhookUrl = `${appUrl}/api/webhooks/hostinger-mail`;
  const hostingerConfig = (hostinger?.config ?? {}) as { defaultTeam?: string };

  return (
    <PageContainer
      pageTitle='Integrations'
      pageDescription='Systems with a purpose-built adapter in the Hub, and anything of theirs that failed.'
      infoContent={INTEGRATIONS_GUIDE}
    >
      <div className='flex flex-col gap-4'>
      {hostinger && (
        <IntegrationStatusCard
          integrationKey={INTEGRATION_KEYS.HOSTINGER_MAIL}
          name='Hostinger Mail'
          description='Detect enquiries, search, send/reply, and link email activity to clients and projects.'
          enabled={hostinger.enabled}
          status={hostinger.status}
          lastSyncAt={hostinger.lastSyncAt}
          lastError={hostinger.lastError}
          ownerEmployeeId={hostinger.ownerEmployeeId}
          employeeOptions={activeEmployees}
        >
          <HostingerMailSettingsForm
            hasCredentials={!!hostinger.credentialsEncrypted}
            webhookUrl={webhookUrl}
            defaultTeam={hostingerConfig.defaultTeam ?? ''}
          />
        </IntegrationStatusCard>
      )}

      {microsoft365 && (
        <IntegrationStatusCard
          integrationKey={INTEGRATION_KEYS.MICROSOFT_365}
          name='Microsoft 365 / SharePoint / OneDrive / NAS'
          description='Reference-only document links on client/project pages, with periodic reachability checks. No credentials required — SYRIX Forma never stores a storage credential for this integration.'
          enabled={microsoft365.enabled}
          status={microsoft365.status}
          lastSyncAt={microsoft365.lastSyncAt}
          lastError={microsoft365.lastError}
          ownerEmployeeId={microsoft365.ownerEmployeeId}
          employeeOptions={activeEmployees}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Dead-letter queue</CardTitle>
          <CardDescription>
            Inbound events that failed processing — a malformed payload, a database error, or a
            reconciliation-pass exception. Nothing here was silently dropped.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeadLetterList
            rows={deadLetters.map((row) => ({
              id: row.id,
              source: row.source,
              error: row.error,
              failedAt: row.failedAt
            }))}
          />
        </CardContent>
      </Card>
      </div>
    </PageContainer>
  );
}
