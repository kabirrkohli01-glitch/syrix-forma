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
import { Textarea } from '@/components/ui/textarea';
import { requestDocumentUpload } from '@/features/documents/actions';
import { documentErrorMessage } from '@/features/documents/utils/errors';
import {
  ACCEPTED_DOCUMENT_LABEL,
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES
} from '@/features/documents/utils/schemas';

export type AttachmentTargets = {
  clients: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  tasks: { id: string; name: string }[];
};

const ACCEPT_ATTRIBUTE = [...ALLOWED_DOCUMENT_MIME_TYPES].join(',');

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload a file into the Hub.
 *
 * The bytes go straight to object storage with a pre-signed URL rather than through a Server
 * Action, so a 25 MB document is not 25 MB of request body. The order is deliberate: ask for the
 * URL (which creates the row and is where every permission check happens), PUT the bytes, then
 * refresh. An upload that fails midway leaves a row with no file, which shows up as a document
 * that will not download — visible and fixable, unlike the reverse order, which leaves bytes in
 * storage nothing points at.
 */
export function UploadDocumentDialog({
  targets,
  fixedAttachment
}: {
  targets: AttachmentTargets;
  /** Set when the dialog is opened from a client or project page — the parent is not a choice there. */
  fixedAttachment?: { kind: 'client' | 'project' | 'task'; id: string; name: string };
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [attachTo, setAttachTo] = React.useState<string>(
    fixedAttachment ? `${fixedAttachment.kind}:${fixedAttachment.id}` : ''
  );

  function chooseFile(next: File | null) {
    setFile(next);
    // Prefill the name from the filename, minus its extension — almost always what someone
    // wants, and always editable. Only when they have not typed one, so it never overwrites.
    if (next && !title.trim()) {
      setTitle(next.name.replace(/\.[^.]+$/, ''));
    }
  }

  const tooBig = file !== null && file.size > MAX_DOCUMENT_BYTES;
  const wrongType = file !== null && !ALLOWED_DOCUMENT_MIME_TYPES.has(file.type);

  function submit() {
    if (!file) return;

    const [kind, id] = attachTo ? attachTo.split(':') : [null, null];

    startTransition(async () => {
      try {
        const result = await requestDocumentUpload({
          title: title.trim(),
          description: description.trim() || undefined,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          clientId: kind === 'client' ? id! : undefined,
          projectId: kind === 'project' ? id! : undefined,
          taskId: kind === 'task' ? id! : undefined
        });

        const response = await fetch(result.upload.url, {
          method: result.upload.method,
          headers: result.upload.headers,
          body: file
        });
        if (!response.ok) {
          throw new Error('The file could not be stored. Nothing has been shared.');
        }

        toast.success(`"${title.trim()}" uploaded`);
        setOpen(false);
        setFile(null);
        setTitle('');
        setDescription('');
      } catch (error) {
        toast.error(documentErrorMessage(error));
      }
    });
  }

  const canSubmit = Boolean(file) && title.trim().length > 0 && !tooBig && !wrongType && !pending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Icons.add aria-hidden />
        Upload
      </DialogTrigger>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
          <DialogDescription>
            Stored by the Hub and downloaded through it, so who can open it follows Hub
            permissions. For a file that already lives in SharePoint, OneDrive or the NAS, use
            &quot;Link a file&quot; instead so that system stays the one copy.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='document-file'>File</Label>
            <Input
              id='document-file'
              type='file'
              accept={ACCEPT_ATTRIBUTE}
              disabled={pending}
              onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            />
            <p className='text-muted-foreground text-xs'>
              {file ? `${file.name} — ${formatBytes(file.size)}` : ACCEPTED_DOCUMENT_LABEL}
            </p>
            {tooBig && (
              <p className='text-destructive text-xs'>
                That file is {formatBytes(file!.size)}, over the {formatBytes(MAX_DOCUMENT_BYTES)}{' '}
                limit. Link to it where it lives instead.
              </p>
            )}
            {wrongType && (
              <p className='text-destructive text-xs'>
                That file type is not accepted here. Accepted: {ACCEPTED_DOCUMENT_LABEL}.
              </p>
            )}
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='document-title'>Name</Label>
            <Input
              id='document-title'
              value={title}
              maxLength={200}
              placeholder='e.g. Signed engagement letter'
              disabled={pending}
              onChange={(e) => setTitle(e.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              What people will look for. This is what appears in the list and in search, not the
              filename.
            </p>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='document-attach'>Belongs to</Label>
            {fixedAttachment ? (
              <p className='text-sm'>{fixedAttachment.name}</p>
            ) : (
              <NativeSelect
                id='document-attach'
                className='w-full'
                value={attachTo}
                disabled={pending}
                onChange={(e) => setAttachTo(e.target.value)}
              >
                <option value=''>Nothing in particular — file it under my team</option>
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
            )}
            <p className='text-muted-foreground text-xs'>
              Attaching it puts it on that record as well as here, and means whoever can see the
              record can see the document. Leave it unattached and it belongs to your team.
            </p>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='document-description'>Note (optional)</Label>
            <Textarea
              id='document-description'
              rows={2}
              maxLength={2000}
              value={description}
              disabled={pending}
              placeholder='What it is, or why it matters'
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? 'Uploading…' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
