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
import { NativeSelect } from '@/components/ui/native-select';
import { addDocumentLink } from '@/features/document-links/actions';
import { documentLinkSystemValues } from '@/features/document-links/utils/schemas';
import type { AttachmentTargets } from './upload-document-dialog';

const SYSTEM_LABELS: Record<(typeof documentLinkSystemValues)[number], string> = {
  sharepoint: 'SharePoint',
  onedrive: 'OneDrive',
  nas: 'Network drive (NAS)',
  other: 'Somewhere else'
};

/**
 * Record a file that lives in another system.
 *
 * Unlike an upload, a link always belongs to a client, a project or a task — that has been the
 * rule since document links were introduced, and it is what decides who can see the link, since
 * the Hub knows nothing about who can open the file at the other end.
 */
export function LinkDocumentDialog({ targets }: { targets: AttachmentTargets }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [label, setLabel] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [system, setSystem] =
    React.useState<(typeof documentLinkSystemValues)[number]>('sharepoint');
  const [attachTo, setAttachTo] = React.useState('');

  const nothingToAttachTo =
    targets.clients.length === 0 && targets.projects.length === 0 && targets.tasks.length === 0;

  function submit() {
    const [kind, id] = attachTo.split(':');

    startTransition(async () => {
      try {
        await addDocumentLink({
          label: label.trim(),
          url: url.trim(),
          system,
          clientId: kind === 'client' ? id : undefined,
          projectId: kind === 'project' ? id : undefined,
          taskId: kind === 'task' ? id : undefined
        });
        toast.success(`"${label.trim()}" linked`);
        setOpen(false);
        setLabel('');
        setUrl('');
        setAttachTo('');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'That link could not be added');
      }
    });
  }

  const canSubmit =
    label.trim().length > 0 && /^https?:\/\//i.test(url.trim()) && attachTo !== '' && !pending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant='outline' />}>
        <Icons.externalLink aria-hidden />
        Link a file
      </DialogTrigger>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Link a file</DialogTitle>
          <DialogDescription>
            The file stays where it is and the Hub records only its address, so whoever owns that
            system still decides who can open it. Use this for anything already in SharePoint,
            OneDrive or the network drive.
          </DialogDescription>
        </DialogHeader>

        {nothingToAttachTo ? (
          <p className='text-muted-foreground text-sm'>
            A link has to belong to a client, a project or a task, and there are none you can add
            to yet. Create one first, or upload the file into the Hub instead.
          </p>
        ) : (
          <div className='flex flex-col gap-4'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='link-label'>Name</Label>
              <Input
                id='link-label'
                value={label}
                maxLength={200}
                placeholder='e.g. 2026 audit working papers'
                disabled={pending}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='link-url'>Address</Label>
              <Input
                id='link-url'
                type='url'
                value={url}
                placeholder='https://…'
                disabled={pending}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                Copy it from your browser&apos;s address bar with the file open. The Hub checks
                periodically that it still resolves and flags it here if it stops.
              </p>
            </div>

            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='link-system'>Where it lives</Label>
              <NativeSelect
                id='link-system'
                className='w-full'
                value={system}
                disabled={pending}
                onChange={(e) => setSystem(e.target.value as typeof system)}
              >
                {documentLinkSystemValues.map((value) => (
                  <option key={value} value={value}>
                    {SYSTEM_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='link-attach'>Belongs to</Label>
              <NativeSelect
                id='link-attach'
                className='w-full'
                value={attachTo}
                disabled={pending}
                onChange={(e) => setAttachTo(e.target.value)}
              >
                <option value=''>Choose one…</option>
                {targets.clients.length > 0 && (
                  <optgroup label='Clients'>
                    {targets.clients.map((c) => (
                      <option key={c.id} value={`client:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {targets.projects.length > 0 && (
                  <optgroup label='Projects'>
                    {targets.projects.map((p) => (
                      <option key={p.id} value={`project:${p.id}`}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {targets.tasks.length > 0 && (
                  <optgroup label='Tasks'>
                    {targets.tasks.map((t) => (
                      <option key={t.id} value={`task:${t.id}`}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </NativeSelect>
              <p className='text-muted-foreground text-xs'>
                Required for a link, because the record it belongs to is what decides who can see
                it here.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={!canSubmit || nothingToAttachTo}>
            {pending ? 'Adding…' : 'Add link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
