'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { resolveDeadLetterEntry } from '@/features/integrations/actions';

export type DeadLetterRow = { id: string; source: string; error: string; failedAt: Date };

export function DeadLetterList({ rows }: { rows: DeadLetterRow[] }) {
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) {
    return <p className='text-muted-foreground text-sm'>No unresolved failures.</p>;
  }

  function handleResolve(id: string) {
    startTransition(async () => {
      try {
        await resolveDeadLetterEntry(id);
        toast.success('Marked as resolved');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to resolve');
      }
    });
  }

  return (
    <div className='overflow-hidden rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>Error</TableHead>
            <TableHead>Failed</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className='font-medium'>{row.source}</TableCell>
              <TableCell className='text-destructive max-w-xs truncate text-xs'>{row.error}</TableCell>
              <TableCell className='text-muted-foreground text-xs'>{row.failedAt.toLocaleString()}</TableCell>
              <TableCell>
                <Button size='sm' variant='outline' disabled={isPending} onClick={() => handleResolve(row.id)}>
                  Resolve
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
