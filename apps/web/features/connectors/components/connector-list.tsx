'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListGroup } from '@/components/ui/list-group';
import { Switch } from '@/components/ui/switch';
import { deleteConnector, setConnectorEnabled, testConnector } from '@/features/connectors/actions';
import { connectorErrorMessage } from '@/features/connectors/utils/errors';
import type { ConnectorRow } from '@/features/connectors/utils/queries';
import { ConnectorFormDialog } from './connector-form-dialog';
import { ConnectorTile } from './connector-tile';

const STATUS: Record<ConnectorRow['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  connected: { label: 'Connected', variant: 'default' },
  unverified: { label: 'Not checked yet', variant: 'secondary' },
  error: { label: 'Not reachable', variant: 'destructive' }
};

function formatWhen(date: Date | null): string {
  if (!date) return 'never checked';
  return `checked ${new Date(date).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })}`;
}

function ConnectorCard({ connector }: { connector: ConnectorRow }) {
  const [pending, startTransition] = React.useTransition();
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  function test() {
    startTransition(async () => {
      try {
        const result = await testConnector(connector.id);
        if (result.verified) toast.success(`${connector.name} answered`);
        else toast.error(result.error ?? 'The check failed');
      } catch (error) {
        toast.error(connectorErrorMessage(error));
      }
    });
  }

  function toggle(enabled: boolean) {
    startTransition(async () => {
      try {
        await setConnectorEnabled(connector.id, enabled);
      } catch (error) {
        toast.error(connectorErrorMessage(error));
      }
    });
  }

  function remove() {
    startTransition(async () => {
      try {
        await deleteConnector(connector.id);
        toast.success(`${connector.name} removed`);
      } catch (error) {
        toast.error(connectorErrorMessage(error));
      } finally {
        setConfirmingDelete(false);
      }
    });
  }

  const status = STATUS[connector.status];

  return (
    <div className='bg-card ring-foreground/10 flex flex-col gap-3 rounded-2xl p-4 ring-1'>
      <div className='flex items-start gap-3'>
        <ConnectorTile
          entry={{
            icon: connector.kind === 'mcp' ? 'sparkles' : 'settings',
            tint: connector.kind === 'mcp' ? '#d97757' : '#475569',
            name: connector.name
          }}
        />
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium'>{connector.name}</p>
          <p className='text-muted-foreground truncate text-xs'>{connector.baseUrl}</p>
          <p className='text-muted-foreground text-xs'>
            {connector.kind === 'mcp' ? 'MCP server' : `HTTP API · ${connector.headerName ?? 'no header'}`}
            {' · '}
            {connector.hasCredential ? 'credential stored' : 'no credential'}
            {' · '}
            {formatWhen(connector.lastCheckedAt)}
          </p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      {connector.status === 'error' && connector.lastError && (
        <p className='text-destructive text-xs'>{connector.lastError}</p>
      )}

      {connector.serverName && (
        <p className='text-muted-foreground text-xs'>
          Reported itself as <span className='font-medium'>{connector.serverName}</span>.
        </p>
      )}

      {connector.tools.length > 0 && (
        <div>
          <p className='text-muted-foreground mb-1 text-xs'>
            {connector.tools.length} tool{connector.tools.length === 1 ? '' : 's'} exposed. Listed
            as the server described them — the Hub does not run them.
          </p>
          <div className='flex flex-wrap gap-1'>
            {connector.tools.slice(0, 12).map((tool) => (
              <Badge key={tool.name} variant='outline' title={tool.description ?? undefined}>
                {tool.name}
              </Badge>
            ))}
            {connector.tools.length > 12 && (
              <Badge variant='outline'>+{connector.tools.length - 12} more</Badge>
            )}
          </div>
        </div>
      )}

      <div className='flex flex-wrap items-center gap-2 border-t pt-3'>
        <div className='mr-auto flex items-center gap-2'>
          <Switch
            id={`enabled-${connector.id}`}
            checked={connector.enabled}
            disabled={pending}
            onCheckedChange={toggle}
          />
          <label htmlFor={`enabled-${connector.id}`} className='text-sm'>
            Enabled
          </label>
        </div>
        <Button variant='outline' size='sm' onClick={test} disabled={pending}>
          {pending ? 'Checking…' : 'Test now'}
        </Button>
        <ConnectorFormDialog kind={connector.kind} existing={connector} />
        {confirmingDelete ? (
          <>
            <Button variant='destructive' size='sm' onClick={remove} disabled={pending}>
              Delete and forget the credential
            </Button>
            <Button variant='ghost' size='sm' onClick={() => setConfirmingDelete(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant='ghost' size='sm' onClick={() => setConfirmingDelete(true)} disabled={pending}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

export function ConnectorList({ connectors }: { connectors: ConnectorRow[] }) {
  if (connectors.length === 0) {
    return (
      <ListGroup>
        <div className='p-4'>
          <p className='text-sm font-medium'>Nothing connected yet</p>
          <p className='text-muted-foreground mt-1 text-sm'>
            Use &quot;Add an MCP server&quot; for a Model Context Protocol endpoint, or &quot;Add
            an API connector&quot; for any service behind a bearer token or API key. Either way
            the Hub tests the credential before it calls itself connected.
          </p>
        </div>
      </ListGroup>
    );
  }

  return (
    <div className='flex flex-col gap-3'>
      {connectors.map((connector) => (
        <ConnectorCard key={connector.id} connector={connector} />
      ))}
    </div>
  );
}
