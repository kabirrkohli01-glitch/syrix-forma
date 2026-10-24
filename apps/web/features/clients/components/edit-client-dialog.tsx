'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CLIENT_STATUS_LABEL } from '@/lib/status-colors';
import { updateClient } from '@/features/clients/actions';
import { clientStatusValues } from '@/features/clients/utils/schemas';

export function EditClientDialog({
  clientId,
  currentName,
  currentServiceLine,
  currentStatus,
  currentTeam,
  canChangeTeam
}: {
  clientId: string;
  currentName: string;
  currentServiceLine: string | null;
  currentStatus: (typeof clientStatusValues)[number];
  currentTeam: string;
  canChangeTeam: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(currentName);
  const [serviceLine, setServiceLine] = useState(currentServiceLine ?? '');
  const [status, setStatus] = useState<(typeof clientStatusValues)[number]>(currentStatus);
  const [team, setTeam] = useState(currentTeam);

  function handleOpenChange(next: boolean) {
    if (next) {
      // Reset to the current server-known values each time the dialog opens, so a cancel
      // followed by a reopen never shows a stale edit from earlier in the session.
      setName(currentName);
      setServiceLine(currentServiceLine ?? '');
      setStatus(currentStatus);
      setTeam(currentTeam);
    }
    setOpen(next);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    startTransition(async () => {
      try {
        await updateClient(clientId, {
          name: name.trim(),
          serviceLine: serviceLine.trim() || null,
          status,
          ...(canChangeTeam && team.trim() !== currentTeam ? { team: team.trim() } : {})
        });
        toast.success('Client updated');
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update client');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant='outline' size='sm' />}>
        <Icons.edit />
        Edit
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit client</DialogTitle>
            <DialogDescription>Update this client's details.</DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-3 py-4'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='edit-client-name'>Name</Label>
              <Input
                id='edit-client-name'
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='edit-client-service-line'>Service line</Label>
              <Input
                id='edit-client-service-line'
                value={serviceLine}
                onChange={(e) => setServiceLine(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='edit-client-status'>Status</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as (typeof clientStatusValues)[number])}
              >
                <SelectTrigger id='edit-client-status' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clientStatusValues.map((value) => (
                    <SelectItem key={value} value={value}>
                      {CLIENT_STATUS_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canChangeTeam && (
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='edit-client-team'>Team</Label>
                <Input
                  id='edit-client-team'
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  maxLength={200}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type='submit' disabled={isPending}>
              {isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
