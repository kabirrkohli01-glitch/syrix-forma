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
import { Textarea } from '@/components/ui/textarea';
import { createEnquiry } from '@/features/enquiries/actions';

export function CreateEnquiryDialog() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [message, setMessage] = useState('');

  function reset() {
    setContactName('');
    setContactEmail('');
    setMessage('');
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!contactName.trim() || !contactEmail.trim()) {
      toast.error('Contact name and email are required');
      return;
    }

    startTransition(async () => {
      try {
        await createEnquiry({
          contactName: contactName.trim(),
          contactEmail: contactEmail.trim(),
          message: message.trim() || undefined
        });
        toast.success('Enquiry logged — a task has been queued for it');
        reset();
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to log the enquiry');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant='outline' />}>
        <Icons.add />
        New Enquiry
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Enquiry</DialogTitle>
            <DialogDescription>
              Manual entry — logs an enquiry and triggers the new-enquiry automation.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-3 py-4'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='enquiry-contact-name'>Contact name</Label>
              <Input
                id='enquiry-contact-name'
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='enquiry-contact-email'>Contact email</Label>
              <Input
                id='enquiry-contact-email'
                type='email'
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                required
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='enquiry-message'>Message</Label>
              <Textarea
                id='enquiry-message'
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={5000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type='submit' disabled={isPending}>
              {isPending ? 'Logging…' : 'Log enquiry'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
