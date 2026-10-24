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
import { createClient } from '@/features/clients/actions';

export function CreateClientDialog() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [serviceLine, setServiceLine] = useState('');

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    startTransition(async () => {
      try {
        await createClient({ name: name.trim(), serviceLine: serviceLine.trim() || undefined });
        toast.success('Client created');
        setName('');
        setServiceLine('');
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to create client');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Icons.add />
        New Client
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Client</DialogTitle>
            <DialogDescription>Standing up a new client record for your team.</DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-3 py-4'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='client-name'>Name</Label>
              <Input
                id='client-name'
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='client-service-line'>Service line</Label>
              <Input
                id='client-service-line'
                value={serviceLine}
                onChange={(e) => setServiceLine(e.target.value)}
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type='submit' disabled={isPending}>
              {isPending ? 'Creating…' : 'Create client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
