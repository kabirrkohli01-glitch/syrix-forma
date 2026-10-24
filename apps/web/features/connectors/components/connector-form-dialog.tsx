'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveHttpConnector, saveMcpConnector } from '@/features/connectors/actions';
import { connectorErrorMessage } from '@/features/connectors/utils/errors';
import type { ConnectorRow } from '@/features/connectors/utils/queries';

/**
 * Add or edit a connector.
 *
 * Secrets are write-only. An existing connector's token is never sent to the browser, so the
 * field starts empty with a note saying one is already stored and that leaving it blank keeps it.
 * That is the only arrangement in which a settings page cannot leak the thing it is configuring
 * by being screenshotted, inspected or cached.
 */
export function ConnectorFormDialog({
  kind,
  existing,
  trigger
}: {
  kind: 'mcp' | 'http_api';
  existing?: ConnectorRow;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const [name, setName] = React.useState(existing?.name ?? '');
  const [baseUrl, setBaseUrl] = React.useState(existing?.baseUrl ?? '');
  const [token, setToken] = React.useState('');
  const [headerName, setHeaderName] = React.useState(existing?.headerName ?? 'Authorization');

  const isMcp = kind === 'mcp';

  function submit() {
    startTransition(async () => {
      try {
        const result = isMcp
          ? await saveMcpConnector({
              connectorId: existing?.id,
              name: name.trim(),
              baseUrl: baseUrl.trim(),
              // Undefined means "keep what is stored"; an explicit empty string is only sent for
              // a brand-new connector, where there is nothing to keep.
              token: token ? token : existing ? undefined : ''
            })
          : await saveHttpConnector({
              connectorId: existing?.id,
              name: name.trim(),
              baseUrl: baseUrl.trim(),
              headerName: headerName.trim(),
              headerValue: token ? token : existing ? undefined : ''
            });

        if (result.verified) {
          toast.success(`${name.trim()} connected`);
        } else {
          // Saved, but honestly labelled. The credential may be right and the service down, so
          // the row is kept — it just does not get to claim it is connected.
          toast.warning(`Saved, but the check failed: ${result.error ?? 'no reason given'}`);
        }
        setOpen(false);
        setToken('');
      } catch (error) {
        toast.error(connectorErrorMessage(error));
      }
    });
  }

  const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0 && !pending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ? (
            (trigger as React.ReactElement)
          ) : (
            <Button variant={existing ? 'ghost' : 'default'} size={existing ? 'sm' : 'default'} />
          )
        }
      >
        {!trigger &&
          (existing ? (
            'Edit'
          ) : (
            <>
              <Icons.add aria-hidden />
              {isMcp ? 'Add an MCP server' : 'Add an API connector'}
            </>
          ))}
      </DialogTrigger>

      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {existing ? `Edit ${existing.name}` : isMcp ? 'Add an MCP server' : 'Add an API connector'}
          </DialogTitle>
          <DialogDescription>
            {isMcp
              ? 'The Hub performs a real Model Context Protocol handshake when you save, and records which tools the server exposes. If it cannot reach it, it says so rather than showing a green tick.'
              : 'The Hub sends one authenticated request to the endpoint you name and reports what came back. "Connected" here always means the service answered.'}
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='connector-name'>Name</Label>
            <Input
              id='connector-name'
              value={name}
              maxLength={100}
              placeholder={isMcp ? 'e.g. Companies House MCP' : 'e.g. Our billing API'}
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              Only for you to recognise it by. It has to be unique.
            </p>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='connector-url'>{isMcp ? 'Server URL' : 'Endpoint to verify against'}</Label>
            <Input
              id='connector-url'
              type='url'
              value={baseUrl}
              placeholder={isMcp ? 'https://example.com/mcp' : 'https://api.example.com/v1/me'}
              disabled={pending}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {isMcp
                ? 'The address the server documents for Streamable HTTP — usually ending in /mcp.'
                : 'Any endpoint returning 200 for a valid credential and 401 for a bad one — typically the "current user" route in that API’s documentation.'}{' '}
              It must be https, and the Hub will not fetch from a private network address.
            </p>
          </div>

          {!isMcp && (
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='connector-header'>Header name</Label>
              <Input
                id='connector-header'
                value={headerName}
                maxLength={100}
                disabled={pending}
                onChange={(e) => setHeaderName(e.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                From the API’s authentication documentation — &quot;Authorization&quot; for a
                bearer token, or something like &quot;X-API-Key&quot; for a key.
              </p>
            </div>
          )}

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='connector-secret'>
              {isMcp ? 'Bearer token' : 'Header value'}
              {isMcp && <span className='text-muted-foreground font-normal'> (if it needs one)</span>}
            </Label>
            <Input
              id='connector-secret'
              type='password'
              autoComplete='off'
              value={token}
              disabled={pending}
              placeholder={
                existing?.hasCredential ? 'A credential is already stored' : isMcp ? 'Paste the token' : 'Bearer sk_live_…'
              }
              onChange={(e) => setToken(e.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {existing?.hasCredential
                ? 'Leave this blank to keep the one already stored. Anything you type replaces it.'
                : isMcp
                  ? 'Sent as an Authorization: Bearer header. Leave blank for a server that needs no authentication.'
                  : 'Written exactly as the header expects it — include the word "Bearer" if the documentation shows it.'}{' '}
              Stored encrypted and never shown again.
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? 'Checking…' : existing ? 'Save and re-check' : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
