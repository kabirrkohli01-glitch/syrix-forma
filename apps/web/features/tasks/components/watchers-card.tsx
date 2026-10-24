'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { addTaskWatcher, removeTaskWatcher } from '@/features/tasks/watchers-actions';

export type WatcherRow = { id: string; employeeId: string; employeeName: string };

export function WatchersCard({
  taskId,
  watchers,
  currentEmployeeId,
  canView
}: {
  taskId: string;
  watchers: WatcherRow[];
  currentEmployeeId: string;
  canView: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const isWatching = watchers.some((w) => w.employeeId === currentEmployeeId);

  function handleToggleSelf() {
    startTransition(async () => {
      try {
        if (isWatching) {
          await removeTaskWatcher(taskId);
        } else {
          await addTaskWatcher(taskId);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update watchers');
      }
    });
  }

  return (
    <div className='flex flex-col gap-3'>
      {watchers.length === 0 ? (
        <p className='text-muted-foreground text-sm'>Nobody is watching this task.</p>
      ) : (
        <div className='flex flex-wrap gap-2'>
          {watchers.map((watcher) => (
            <Badge key={watcher.id} variant='outline'>
              {watcher.employeeName}
            </Badge>
          ))}
        </div>
      )}

      {canView && (
        <Button variant='outline' size='sm' className='self-start' disabled={isPending} onClick={handleToggleSelf}>
          <Icons.eye className='size-3.5' />
          {isWatching ? 'Stop watching' : 'Watch this task'}
        </Button>
      )}
    </div>
  );
}
