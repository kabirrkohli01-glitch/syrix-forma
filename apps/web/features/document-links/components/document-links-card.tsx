'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
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
import { addDocumentLink, removeDocumentLink } from '@/features/document-links/actions';
import { documentLinkSystemValues } from '@/features/document-links/utils/schemas';

export type DocumentLinkRow = {
  id: string;
  label: string;
  url: string;
  system: (typeof documentLinkSystemValues)[number];
  lastCheckStatus: 'unknown' | 'ok' | 'broken';
  lastCheckedAt: Date | null;
};

const STATUS_VARIANT: Record<DocumentLinkRow['lastCheckStatus'], 'default' | 'destructive' | 'outline'> = {
  ok: 'default',
  broken: 'destructive',
  unknown: 'outline'
};

export function DocumentLinksCard({
  links,
  canManage,
  clientId,
  projectId,
  taskId
}: {
  links: DocumentLinkRow[];
  canManage: boolean;
  clientId?: string;
  projectId?: string;
  taskId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [system, setSystem] = useState<(typeof documentLinkSystemValues)[number]>('sharepoint');

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      try {
        await addDocumentLink({ label, url, system, clientId, projectId, taskId });
        toast.success('Link added');
        setLabel('');
        setUrl('');
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add the link');
      }
    });
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      try {
        await removeDocumentLink(id);
        toast.success('Link removed');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove the link');
      }
    });
  }

  return (
    <div className='flex flex-col gap-3'>
      {links.length === 0 ? (
        <p className='text-muted-foreground text-sm'>No document links yet.</p>
      ) : (
        <ul className='flex flex-col gap-2'>
          {links.map((link) => (
            <li key={link.id} className='flex items-center justify-between gap-2 text-sm'>
              <a
                href={link.url}
                target='_blank'
                rel='noreferrer'
                className='flex min-w-0 items-center gap-1.5 truncate hover:underline'
              >
                <Icons.externalLink className='size-3.5 shrink-0' />
                <span className='truncate'>{link.label}</span>
              </a>
              <div className='flex shrink-0 items-center gap-2'>
                <Badge variant='outline' className='capitalize'>
                  {link.system}
                </Badge>
                <Badge variant={STATUS_VARIANT[link.lastCheckStatus]}>{link.lastCheckStatus}</Badge>
                {canManage && (
                  <Button size='icon-sm' variant='ghost' disabled={isPending} onClick={() => handleRemove(link.id)}>
                    <Icons.close className='size-3.5' />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button variant='outline' size='sm' />}>
            <Icons.add />
            Add link
          </DialogTrigger>
          <DialogContent className='sm:max-w-md'>
            <form onSubmit={handleAdd}>
              <DialogHeader>
                <DialogTitle>Add document link</DialogTitle>
                <DialogDescription>
                  Reference-only — SYRIX Forma stores the link and label, never the file itself or a
                  storage credential.
                </DialogDescription>
              </DialogHeader>
              <div className='flex flex-col gap-3 py-4'>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='doc-link-label'>Label</Label>
                  <Input id='doc-link-label' value={label} onChange={(e) => setLabel(e.target.value)} required />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='doc-link-url'>URL</Label>
                  <Input
                    id='doc-link-url'
                    type='url'
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder='https://...'
                    required
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label>System</Label>
                  <Select value={system} onValueChange={(v) => setSystem(v as typeof system)}>
                    <SelectTrigger className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {documentLinkSystemValues.map((value) => (
                        <SelectItem key={value} value={value} className='capitalize'>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type='submit' disabled={isPending}>
                  {isPending ? 'Adding…' : 'Add link'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
