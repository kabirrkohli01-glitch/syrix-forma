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
import { Textarea } from '@/components/ui/textarea';
import { sendEnquiryReply } from '@/features/enquiries/actions';

export function ReplyToEnquiryDialog({ enquiryId, contactName }: { enquiryId: string; contactName: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState('');

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      toast.error('Message body is required');
      return;
    }
    startTransition(async () => {
      try {
        await sendEnquiryReply(enquiryId, { text: text.trim() });
        toast.success('Reply sent');
        setText('');
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to send the reply');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant='ghost' size='sm' />}>
        <Icons.chat />
        Reply
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Reply to {contactName}</DialogTitle>
            <DialogDescription>
              Sent via the connected Hostinger mailbox, threaded against their message if there is
              one.
            </DialogDescription>
          </DialogHeader>
          <div className='py-4'>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={20000}
              rows={6}
              placeholder='Write your reply…'
            />
          </div>
          <DialogFooter>
            <Button type='submit' disabled={isPending}>
              {isPending ? 'Sending…' : 'Send reply'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
