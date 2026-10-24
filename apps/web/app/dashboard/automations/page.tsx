import type { Metadata } from 'next';
import { AUTOMATIONS_GUIDE } from '@/config/page-guides';
import { desc, eq, sql } from 'drizzle-orm';
import { Icons } from '@/components/icons';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AutomationCard } from '@/features/automations/components/automation-card';
import { KillSwitchToggle } from '@/features/automations/components/kill-switch-toggle';
import { CreateEnquiryDialog } from '@/features/enquiries/components/create-enquiry-dialog';
import { EnquiryStatusSelect } from '@/features/enquiries/components/enquiry-status-select';
import { ReplyToEnquiryDialog } from '@/features/enquiries/components/reply-to-enquiry-dialog';
import { enquiryScopeCondition } from '@/features/enquiries/utils/scope';
import { db } from '@/lib/db/client';
import { automationRuns, automations, automationSettings, employees, enquiries } from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import type { AutomationKey } from '@/lib/automations/keys';
import { INTEGRATION_KEYS } from '@/lib/integrations/keys';
import { isIntegrationEnabled } from '@/lib/integrations/settings';
import { canCreateEnquiry, canEditEnquiry } from '@/lib/permissions/enquiry-access';
import { canViewAutomations } from '@/lib/permissions/automation-access';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

export const metadata: Metadata = { title: 'Automations' };

const RUN_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  success: 'default',
  running: 'secondary',
  queued: 'secondary',
  skipped: 'outline',
  failed: 'destructive'
};

export default async function AutomationsPage() {
  const employee = await requireActiveEmployeeForPage();

  // Automation definitions/run history and Enquiries are gated independently, not as one
  // page-wide check: automations are ADMIN-only (docs/permissions-matrix.md), but Enquiries
  // follow the same own/team/cross-team scope as Task/Client/Project and must stay visible to
  // non-ADMIN roles even though they share this page for now.
  const canSeeAutomations = canViewAutomations(employee);
  const enquiryScope = scopeForBusinessData(employee.role);
  const canSeeEnquiries = enquiryScope !== 'none';

  if (!canSeeAutomations && !canSeeEnquiries) {
    return (
      <PageContainer pageTitle='Automations' access={false}>
        {null}
      </PageContainer>
    );
  }

  const [settings] = canSeeAutomations
    ? await db.select().from(automationSettings).where(eq(automationSettings.id, 'singleton')).limit(1)
    : [undefined];

  const automationRows = canSeeAutomations
    ? await db
        .select({
          id: automations.id,
          key: automations.key,
          name: automations.name,
          description: automations.description,
          triggerEvent: automations.triggerEvent,
          enabled: automations.enabled,
          config: automations.config,
          ownerEmployeeId: automations.ownerEmployeeId
        })
        .from(automations)
        .orderBy(automations.name)
    : [];

  // Per-automation run stats for the card's "last run · N total runs" caption — a small grouped
  // aggregate over the same automation_runs table recentRuns below reads from, not a new source.
  const runStatRows = canSeeAutomations
    ? await db
        .select({
          automationId: automationRuns.automationId,
          count: sql<number>`count(*)::int`,
          lastRunAt: sql<Date>`max(${automationRuns.createdAt})`
        })
        .from(automationRuns)
        .groupBy(automationRuns.automationId)
    : [];
  const runStatsByAutomationId = new Map(
    runStatRows.map((r) => [r.automationId, { count: r.count, lastRunAt: r.lastRunAt }])
  );

  const activeEmployees = canSeeAutomations
    ? await db
        .select({ id: employees.id, name: employeeDisplayName })
        .from(employees)
        .where(eq(employees.status, 'active'))
        .orderBy(employeeDisplayName)
    : [];

  const recentRuns = canSeeAutomations
    ? await db
        .select({
          id: automationRuns.id,
          status: automationRuns.status,
          error: automationRuns.error,
          createdAt: automationRuns.createdAt,
          finishedAt: automationRuns.finishedAt,
          automationName: automations.name
        })
        .from(automationRuns)
        .innerJoin(automations, eq(automationRuns.automationId, automations.id))
        .orderBy(desc(automationRuns.createdAt))
        .limit(20)
    : [];

  // Enquiries: the manual trigger for the new-enquiry automation, and the way to move one into
  // 'awaiting_response' to demonstrate the follow-up automation.
  const enquiryRows = canSeeEnquiries
    ? await db
        .select()
        .from(enquiries)
        .where(enquiryScopeCondition(employee))
        .orderBy(desc(enquiries.createdAt))
        .limit(20)
    : [];

  const canReplyByEmail = canSeeEnquiries && (await isIntegrationEnabled(INTEGRATION_KEYS.HOSTINGER_MAIL));

  return (
    <PageContainer
      pageTitle='Automations'
      infoContent={AUTOMATIONS_GUIDE}
      pageDescription='Rule-driven workflows: event, rule, action, result, audit.'
    >
      <div className='flex flex-col gap-6'>
        {canSeeAutomations && (
          <>
        <Card>
          <CardHeader>
            <CardTitle>Master kill-switch</CardTitle>
          </CardHeader>
          <CardContent>
            <KillSwitchToggle enabled={settings?.killSwitchEnabled ?? false} />
          </CardContent>
        </Card>

        <div className='flex flex-col gap-4'>
          {automationRows.map((automation) => (
            <AutomationCard
              key={automation.key}
              automation={{ ...automation, key: automation.key as AutomationKey }}
              employeeOptions={activeEmployees}
              runStats={runStatsByAutomationId.get(automation.id) ?? null}
            />
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Run history</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <p className='text-muted-foreground text-sm'>No automation has run yet.</p>
            ) : (
              <div className='overflow-hidden rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Automation</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentRuns.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className='font-medium'>{run.automationName}</TableCell>
                        <TableCell>
                          <Badge variant={RUN_STATUS_VARIANT[run.status] ?? 'outline'}>{run.status}</Badge>
                        </TableCell>
                        <TableCell className='text-muted-foreground'>
                          {run.createdAt.toLocaleString()}
                        </TableCell>
                        <TableCell className='text-destructive max-w-xs truncate text-xs'>
                          {run.error ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
          </>
        )}

        {canSeeEnquiries && (
        <Card>
          <CardHeader className='flex flex-row items-center justify-between'>
            <CardTitle>Enquiries</CardTitle>
            {canCreateEnquiry(employee) && <CreateEnquiryDialog />}
          </CardHeader>
          <CardContent>
            {enquiryRows.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <Icons.sparkles />
                  </EmptyMedia>
                  <EmptyTitle>No enquiries yet</EmptyTitle>
                  <EmptyDescription>
                    Log one to see the new-enquiry automation create a task automatically. Phase
                    4&apos;s email integration will create these too — this is also its manual
                    fallback path.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className='overflow-hidden rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contact</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead>Status</TableHead>
                      {canReplyByEmail && <TableHead />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enquiryRows.map((enquiry) => (
                      <TableRow key={enquiry.id}>
                        <TableCell>
                          <div className='font-medium'>{enquiry.contactName}</div>
                          <div className='text-muted-foreground text-xs'>{enquiry.contactEmail}</div>
                        </TableCell>
                        <TableCell className='text-muted-foreground'>{enquiry.team}</TableCell>
                        <TableCell>
                          <EnquiryStatusSelect enquiryId={enquiry.id} status={enquiry.status} />
                        </TableCell>
                        {canReplyByEmail && (
                          <TableCell>
                            {canEditEnquiry(employee, { id: enquiry.id, team: enquiry.team }) && (
                              <ReplyToEnquiryDialog enquiryId={enquiry.id} contactName={enquiry.contactName} />
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        )}
      </div>
    </PageContainer>
  );
}
