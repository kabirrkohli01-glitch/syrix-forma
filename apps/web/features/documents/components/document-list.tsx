'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { archiveDocument, getDocumentDownloadUrl } from '@/features/documents/actions';
import { documentErrorMessage } from '@/features/documents/utils/errors';
import { removeDocumentLink } from '@/features/document-links/actions';
import type { DocumentRow } from '@/features/documents/utils/queries';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

const PARENT_HREF: Record<'client' | 'project' | 'task', string> = {
  client: '/dashboard/clients',
  project: '/dashboard/projects',
  task: '/dashboard/my-work'
};

// The Hub has no "policy folders" taxonomy for documents — every row is attached to a client,
// project or task (or nothing). Grouping by that real attachment kind, rather than inventing a
// folder structure the schema doesn't have, is the honest equivalent of a folder sidebar.
type Group = 'all' | 'client' | 'project' | 'task' | 'unattached';

const GROUP_LABEL: Record<Group, string> = {
  all: 'All documents',
  client: 'Clients',
  project: 'Projects',
  task: 'Tasks',
  unattached: 'Unattached'
};

function DownloadButton({ document }: { document: DocumentRow }) {
  const [pending, startTransition] = React.useTransition();

  function download() {
    startTransition(async () => {
      try {
        const { url } = await getDocumentDownloadUrl(document.id);
        // A fresh, short-lived signed URL each time, opened rather than rendered: the permission
        // is re-checked at the moment of download, so a link copied out of the page is not a
        // standing grant to anyone who later obtains it.
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (error) {
        toast.error(documentErrorMessage(error));
      }
    });
  }

  return (
    <Button variant='ghost' size='sm' onClick={download} disabled={pending}>
      {pending ? 'Opening…' : 'Download'}
    </Button>
  );
}

function RemoveButton({ document }: { document: DocumentRow }) {
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);

  function remove() {
    startTransition(async () => {
      try {
        if (document.kind === 'file') {
          await archiveDocument(document.id);
          toast.success(`"${document.title}" withdrawn`);
        } else {
          await removeDocumentLink(document.id);
          toast.success(`"${document.title}" removed`);
        }
      } catch (error) {
        toast.error(documentErrorMessage(error));
      } finally {
        setConfirming(false);
      }
    });
  }

  // Two presses rather than a modal. Removing a document is reversible for HR (the row is
  // archived, not deleted) but it disappears from every record that pointed at it, so it should
  // not happen on one stray click either.
  if (!confirming) {
    return (
      <Button variant='ghost' size='sm' onClick={() => setConfirming(true)} disabled={pending}>
        Remove
      </Button>
    );
  }

  return (
    <span className='flex items-center gap-1'>
      <Button variant='destructive' size='sm' onClick={remove} disabled={pending}>
        {pending ? 'Removing…' : 'Confirm'}
      </Button>
      <Button variant='ghost' size='sm' onClick={() => setConfirming(false)} disabled={pending}>
        Keep
      </Button>
    </span>
  );
}

export function DocumentList({
  documents,
  currentEmployeeId
}: {
  documents: DocumentRow[];
  currentEmployeeId: string;
}) {
  const [query, setQuery] = React.useState('');
  const [kind, setKind] = React.useState<'all' | 'file' | 'link'>('all');
  const [group, setGroup] = React.useState<Group>('all');

  const counts = React.useMemo(() => {
    const c: Record<Group, number> = { all: documents.length, client: 0, project: 0, task: 0, unattached: 0 };
    for (const d of documents) c[d.attachedTo?.kind ?? 'unattached']++;
    return c;
  }, [documents]);

  // Filtered here rather than by re-querying: the page loads the caller's most recent hundred,
  // which is small enough that typing should not wait on the network. The server-side filter
  // exists too and is what search uses; this is the narrowing of what is already on screen.
  const visible = documents.filter((document) => {
    if (group !== 'all' && (document.attachedTo?.kind ?? 'unattached') !== group) return false;
    if (kind !== 'all' && document.kind !== kind) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return (
      document.title.toLowerCase().includes(needle) ||
      document.detail.toLowerCase().includes(needle) ||
      (document.attachedTo?.name.toLowerCase().includes(needle) ?? false)
    );
  });

  return (
    <div className='flex flex-col gap-4 md:flex-row'>
      <div className='flex shrink-0 flex-col gap-1 md:w-56'>
        <h3 className='text-muted-foreground px-2 text-xs font-medium tracking-wide uppercase'>
          Attached to
        </h3>
        {(Object.keys(GROUP_LABEL) as Group[]).map((g) => (
          <button
            key={g}
            type='button'
            onClick={() => setGroup(g)}
            className={`flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
              group === g ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-muted'
            }`}
          >
            <span>{GROUP_LABEL[g]}</span>
            <span className='text-muted-foreground text-xs tabular-nums'>{counts[g]}</span>
          </button>
        ))}
      </div>

      <div className='flex min-w-0 flex-1 flex-col gap-4'>
        <div className='flex flex-wrap items-center gap-3'>
          <Input
            aria-label='Filter documents'
            placeholder='Filter by name, file or what it belongs to'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className='max-w-sm'
          />
          <SegmentedControl
            label='Document kind'
            value={kind}
            onValueChange={(value) => setKind(value as 'all' | 'file' | 'link')}
            items={[
              { value: 'all', label: 'All' },
              { value: 'file', label: 'In the Hub' },
              { value: 'link', label: 'Linked' }
            ]}
          />
        </div>

        {visible.length === 0 ? (
          <Card>
            <CardContent className='p-4'>
              <p className='text-sm font-medium'>
                {documents.length === 0 ? 'No documents yet' : 'Nothing matches that'}
              </p>
              <p className='text-muted-foreground mt-1 text-sm'>
                {documents.length === 0
                  ? 'Press Upload to put a file in the Hub, or "Link a file" to point at one that already lives in SharePoint, OneDrive or the network drive. Either way, attaching it to a client or project is what makes it findable from that record.'
                  : 'Try a shorter search, or switch a filter back to All.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className='overflow-hidden py-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead className='text-right'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((document) => (
                  <TableRow key={`${document.kind}-${document.id}`}>
                    <TableCell className='max-w-0'>
                      <div className='flex items-center gap-2.5'>
                        <span className='text-muted-foreground shrink-0'>
                          {document.kind === 'file' ? (
                            <Icons.page aria-hidden />
                          ) : (
                            <Icons.externalLink aria-hidden />
                          )}
                        </span>
                        <div className='flex min-w-0 flex-col'>
                          <span className='truncate text-sm font-medium whitespace-normal'>
                            {document.kind === 'link' && document.url ? (
                              <a
                                href={document.url}
                                target='_blank'
                                rel='noreferrer noopener'
                                className='hover:underline'
                              >
                                {document.title}
                              </a>
                            ) : (
                              document.title
                            )}
                          </span>
                          <span className='text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs'>
                            <span>{document.detail}</span>
                            <span>· {document.addedByName}</span>
                            {document.attachedTo && (
                              <>
                                <span>·</span>
                                <Link
                                  href={`${PARENT_HREF[document.attachedTo.kind]}/${document.attachedTo.id}`}
                                  className='hover:underline'
                                >
                                  {document.attachedTo.name}
                                </Link>
                              </>
                            )}
                            {document.linkStatus === 'broken' && (
                              <Badge variant='destructive'>Link broken</Badge>
                            )}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className='text-muted-foreground'>
                      {document.sizeBytes !== null ? formatBytes(document.sizeBytes) : '—'}
                    </TableCell>
                    <TableCell className='text-muted-foreground'>
                      {formatDate(document.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant='secondary'>{document.team ?? 'All teams'}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center justify-end gap-1'>
                        {document.kind === 'file' && <DownloadButton document={document} />}
                        {document.addedByEmployeeId === currentEmployeeId && (
                          <RemoveButton document={document} />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
        <p className='text-muted-foreground text-xs'>
          {visible.length} of {documents.length} shown. You only ever see documents belonging to
          records you can already open.
        </p>
      </div>
    </div>
  );
}
