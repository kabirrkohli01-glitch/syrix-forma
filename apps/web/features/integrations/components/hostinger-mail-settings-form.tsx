'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  removeHostingerMailCredentials,
  saveHostingerMailCredentials,
  testHostingerMailConnection
} from '@/features/integrations/actions';

export function HostingerMailSettingsForm({
  hasCredentials,
  webhookUrl,
  defaultTeam
}: {
  hasCredentials: boolean;
  webhookUrl: string;
  defaultTeam: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [apiToken, setApiToken] = useState('');
  const [mailboxResourceId, setMailboxResourceId] = useState('');
  const [webhookToken, setWebhookToken] = useState('');
  const [team, setTeam] = useState(defaultTeam);

  function handleSave() {
    if (!apiToken || !mailboxResourceId || !webhookToken || !team) {
      toast.error('Every field is required');
      return;
    }
    startTransition(async () => {
      try {
        await saveHostingerMailCredentials({
          apiToken,
          mailboxResourceId,
          webhookToken,
          defaultTeam: team
        });
        setApiToken('');
        setMailboxResourceId('');
        setWebhookToken('');
        toast.success('Credentials saved');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save credentials');
      }
    });
  }

  function handleTest() {
    startTransition(async () => {
      try {
        await testHostingerMailConnection();
        toast.success('Connected — the mailbox responded');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Connection test failed');
      }
    });
  }

  function handleRemove() {
    startTransition(async () => {
      try {
        await removeHostingerMailCredentials();
        toast.success('Credentials removed — the integration is now disabled');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove credentials');
      }
    });
  }

  return (
    <div className='flex flex-col gap-3 border-t pt-3'>
      <div className='flex flex-col gap-1'>
        <Label>Webhook URL (register this in hPanel → Agentic Mail → Webhooks)</Label>
        <Input readOnly value={webhookUrl} className='text-muted-foreground text-xs' />
      </div>

      <div className='flex flex-col gap-1'>
        <Label htmlFor='hostinger-api-token'>API token</Label>
        <Input
          id='hostinger-api-token'
          type='password'
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          placeholder={hasCredentials ? '•••••••• (saved — enter a new value to replace)' : 'hPanel → Emails → API'}
        />
      </div>

      <div className='flex flex-col gap-1'>
        <Label htmlFor='hostinger-mailbox-id'>Mailbox resource ID</Label>
        <Input
          id='hostinger-mailbox-id'
          value={mailboxResourceId}
          onChange={(e) => setMailboxResourceId(e.target.value)}
          placeholder={hasCredentials ? '•••••••• (saved)' : 'From the Mail API mailbox list'}
        />
      </div>

      <div className='flex flex-col gap-1'>
        <Label htmlFor='hostinger-webhook-token'>Webhook bearer token</Label>
        <Input
          id='hostinger-webhook-token'
          type='password'
          value={webhookToken}
          onChange={(e) => setWebhookToken(e.target.value)}
          placeholder={hasCredentials ? '•••••••• (saved)' : 'Shown once when you create the webhook'}
        />
      </div>

      <div className='flex flex-col gap-1'>
        <Label htmlFor='hostinger-default-team'>Default team for new email enquiries</Label>
        <Input id='hostinger-default-team' value={team} onChange={(e) => setTeam(e.target.value)} />
      </div>

      <div className='flex flex-wrap gap-2'>
        <Button size='sm' disabled={isPending} onClick={handleSave}>
          Save credentials
        </Button>
        {hasCredentials && (
          <>
            <Button size='sm' variant='secondary' disabled={isPending} onClick={handleTest}>
              Test connection
            </Button>
            <Button size='sm' variant='destructive' disabled={isPending} onClick={handleRemove}>
              Remove
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
