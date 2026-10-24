import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { ListGroup, ListRow } from '@/components/ui/list-group';
import { CONNECTOR_CATALOGUE, NOT_WIRED_UP } from '@/config/connectors';
import { CONNECTORS_GUIDE } from '@/config/page-guides';
import { ConnectorFormDialog } from '@/features/connectors/components/connector-form-dialog';
import { ConnectorList } from '@/features/connectors/components/connector-list';
import { ConnectorTile } from '@/features/connectors/components/connector-tile';
import {
  describeEnvironmentServices,
  listConnectors
} from '@/features/connectors/utils/queries';
import { ForbiddenError, requireRole } from '@/lib/permissions/current-employee';

export const metadata: Metadata = { title: 'Connectors' };

export default async function ConnectorsPage() {
  // Same 404-not-403 gate as Access Control and Integrations — a non-admin gets no confirmation
  // that a page holding credentials exists at all (engineering rule 10).
  let admin;
  try {
    admin = await requireRole('ADMIN');
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const rows = await listConnectors(admin);
  const environment = describeEnvironmentServices();
  const hostingerMail = CONNECTOR_CATALOGUE.find((entry) => entry.key === 'hostinger_mail')!;

  return (
    <PageContainer
      pageTitle='Connectors'
      pageDescription='Outside services the Hub can reach, and the one place their credentials are entered.'
      infoContent={CONNECTORS_GUIDE}
      pageHeaderAction={
        <div className='flex flex-wrap gap-2'>
          <ConnectorFormDialog kind='http_api' />
          <ConnectorFormDialog kind='mcp' />
        </div>
      }
    >
      <div className='flex flex-col gap-8'>
        <section className='flex flex-col gap-3'>
          <div className='px-1'>
            <h2 className='text-sm font-medium'>Your connectors</h2>
            <p className='text-muted-foreground text-xs'>
              Credentials are encrypted with AES-256-GCM before they are stored and are never
              rendered back to the browser. Adding or changing one asks for your authenticator
              code and is written to the audit log — the address is recorded, the secret never is.
            </p>
          </div>
          <ConnectorList connectors={rows} />
        </section>

        <section className='flex flex-col gap-3'>
          <div className='px-1'>
            <h2 className='text-sm font-medium'>Built into the Hub</h2>
            <p className='text-muted-foreground text-xs'>
              Services this codebase has a purpose-built adapter for, rather than a generic
              connection.
            </p>
          </div>
          <ListGroup>
            <ListRow
              leading={<ConnectorTile entry={hostingerMail} className='size-7 [&_svg]:size-4' />}
              label={hostingerMail.name}
              description={hostingerMail.summary}
              value={<Badge variant='secondary'>Used by {hostingerMail.usedBy}</Badge>}
              href='/dashboard/settings/integrations'
            />
          </ListGroup>
        </section>

        <section className='flex flex-col gap-3'>
          <div className='px-1'>
            <h2 className='text-sm font-medium'>Set in the server environment</h2>
            <p className='text-muted-foreground text-xs'>
              Configured where the Hub runs rather than on this page, because they have to be
              available before the app can start. Shown here as present or absent only — no value
              from the environment is ever rendered.
            </p>
          </div>
          <ListGroup>
            {environment.map((service) => (
              <ListRow
                key={service.key}
                label={service.name}
                description={service.detail}
                value={
                  <Badge variant={service.configured ? 'default' : 'secondary'}>
                    {service.configured ? 'Configured' : 'Not set'}
                  </Badge>
                }
              />
            ))}
          </ListGroup>
        </section>

        <section className='flex flex-col gap-3'>
          <div className='px-1'>
            <h2 className='text-sm font-medium'>Not wired up yet</h2>
            <p className='text-muted-foreground text-xs'>
              These are listed so the shape of what is possible is visible, and no form is offered
              for them: the Hub has no code that reads their credentials, so connecting one would
              store a secret nothing uses. Several of them can be reached today anyway — add them
              as an API connector above, or as an MCP server where the service publishes one.
            </p>
          </div>
          <ListGroup>
            {NOT_WIRED_UP.map((entry) => (
              <ListRow
                key={entry.key}
                leading={<ConnectorTile entry={entry} className='size-7 [&_svg]:size-4' />}
                label={entry.name}
                description={entry.summary}
                value={<span className='text-muted-foreground text-xs'>{entry.category}</span>}
              />
            ))}
          </ListGroup>
        </section>
      </div>
    </PageContainer>
  );
}
