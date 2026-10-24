'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
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
import { ListGroup, ListRow } from '@/components/ui/list-group';
import { NativeSelect } from '@/components/ui/native-select';
import {
  acknowledgeHrDocument,
  getHrDocumentDownloadUrl,
  requestHrDocumentUpload
} from '@/features/hr/document-actions';
import { hrErrorMessage } from '@/features/hr/utils/errors';
import type { HrDocumentRow } from '@/features/hr/utils/performance-queries';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DownloadButton({ documentId }: { documentId: string }) {
  const [pending, setPending] = React.useState(false);

  return (
    <Button
      variant='ghost'
      size='sm'
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const { url } = await getHrDocumentDownloadUrl({ documentId });
          // Opened rather than navigated to: the URL is short-lived and single-purpose, and
          // replacing the current page with a file download loses the user's place.
          window.open(url, '_blank', 'noopener,noreferrer');
        } catch (error) {
          toast.error(hrErrorMessage(error));
        } finally {
          setPending(false);
        }
      }}
    >
      Open
    </Button>
  );
}

function AcknowledgeButton({ document }: { document: HrDocumentRow }) {
  const [open, setOpen] = React.useState(false);
  const [typedName, setTypedName] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size='sm' />}>Acknowledge</DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Acknowledge “{document.title}”</DialogTitle>
          <DialogDescription>
            Type your full name to record that you have read and accepted this document. This is an
            internal record of acknowledgement, not a legally binding electronic signature.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor={`ack-${document.id}`}>Your full name</Label>
          <Input
            id={`ack-${document.id}`}
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            autoComplete='off'
          />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!typedName.trim() || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await acknowledgeHrDocument({ documentId: document.id, typedName });
                  toast.success('Acknowledged');
                  setOpen(false);
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Saving…' : 'Acknowledge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UploadDocumentDialog({
  employeeOptions
}: {
  employeeOptions: { id: string; name: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [visibility, setVisibility] = React.useState<'company' | 'employee'>('company');
  const [employeeId, setEmployeeId] = React.useState(employeeOptions[0]?.id ?? '');
  const [requiresAcknowledgement, setRequiresAcknowledgement] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);

  async function upload() {
    if (!file) return;
    setPending(true);
    try {
      // Two steps: the row and a pre-signed URL come back together, then the browser PUTs the
      // bytes straight to storage. The file never passes through the app server.
      const { upload: target } = await requestHrDocumentUpload({
        title: title.trim(),
        visibility,
        employeeId: visibility === 'employee' ? employeeId : undefined,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        requiresAcknowledgement
      });

      const response = await fetch(target.url, {
        method: target.method,
        headers: target.headers,
        body: file
      });
      if (!response.ok) throw new Error('Upload failed');

      toast.success('Document uploaded');
      setOpen(false);
      setTitle('');
      setFile(null);
    } catch (error) {
      toast.error(hrErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Icons.upload aria-hidden />
        Upload
      </DialogTrigger>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
          <DialogDescription>
            Company documents are visible to everyone. Personal documents are visible to that
            employee and to HR only — not to their line manager.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='doc-title'>Title</Label>
            <Input id='doc-title' value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='doc-visibility'>Visible to</Label>
            <NativeSelect
              className='w-full'
              id='doc-visibility'
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'company' | 'employee')}
            >
              <option value='company'>Everyone at the organisation</option>
              <option value='employee'>One employee</option>
            </NativeSelect>
          </div>

          {visibility === 'employee' && (
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='doc-employee'>Employee</Label>
              <NativeSelect
                className='w-full'
                id='doc-employee'
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                {employeeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='doc-file'>File</Label>
            <Input
              id='doc-file'
              type='file'
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className='text-muted-foreground text-xs'>
              PDF, Word, Excel, image or plain text, up to 25 MB.
            </p>
          </div>

          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={requiresAcknowledgement}
              onChange={(e) => setRequiresAcknowledgement(e.target.checked)}
            />
            Require the audience to acknowledge it
          </label>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button disabled={!title.trim() || !file || pending} onClick={upload}>
            {pending ? 'Uploading…' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentList({ documents }: { documents: HrDocumentRow[] }) {
  const company = documents.filter((d) => d.visibility === 'company');
  const personal = documents.filter((d) => d.visibility === 'employee');

  function row(document: HrDocumentRow) {
    const needsAction = document.requiresAcknowledgement && !document.acknowledgedAt;
    return (
      <ListRow
        key={document.id}
        label={document.title}
        description={[document.fileName, formatSize(document.sizeBytes), document.employeeName]
          .filter(Boolean)
          .join(' · ')}
        leading={<Icons.page aria-hidden />}
        value={
          document.requiresAcknowledgement ? (
            <Badge variant={document.acknowledgedAt ? 'secondary' : 'outline'}>
              {document.acknowledgedAt ? 'acknowledged' : 'needs acknowledgement'}
            </Badge>
          ) : undefined
        }
        action={
          <span className='flex items-center gap-1'>
            <DownloadButton documentId={document.id} />
            {needsAction && <AcknowledgeButton document={document} />}
          </span>
        }
      />
    );
  }

  if (documents.length === 0) {
    return (
      <ListGroup label='Documents'>
        <ListRow
          label='No documents yet'
          description='Handbooks and policies shared with everyone, and contracts or letters on your own record, appear here.'
          leading={<Icons.page aria-hidden />}
        />
      </ListGroup>
    );
  }

  return (
    <>
      {company.length > 0 && <ListGroup label='Company'>{company.map(row)}</ListGroup>}
      {personal.length > 0 && (
        <ListGroup
          label='Personal'
          note='Visible to the employee and to HR. A line manager does not see these.'
        >
          {personal.map(row)}
        </ListGroup>
      )}
    </>
  );
}
