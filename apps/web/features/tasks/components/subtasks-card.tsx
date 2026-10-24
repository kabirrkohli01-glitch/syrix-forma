'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createTask } from '@/features/tasks/actions';
import { TASK_STATUS_LABEL } from '@/features/tasks/utils/labels';
import type { taskStatusValues } from '@/features/tasks/utils/schemas';

export type SubtaskRow = {
  id: string;
  title: string;
  status: (typeof taskStatusValues)[number];
  assigneeName: string | null;
};

export function SubtasksCard({
  parentTaskId,
  subtasks,
  canManage
}: {
  parentTaskId: string;
  subtasks: SubtaskRow[];
  canManage: boolean;
}) {
  const [title, setTitle] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    startTransition(async () => {
      try {
        await createTask({ title: title.trim(), parentTaskId });
        setTitle('');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add subtask');
      }
    });
  }

  return (
    <div className='flex flex-col gap-3'>
      {subtasks.length === 0 ? (
        <p className='text-muted-foreground text-sm'>No subtasks yet.</p>
      ) : (
        <ul className='flex flex-col gap-2'>
          {subtasks.map((subtask) => (
            <li key={subtask.id} className='flex items-center justify-between gap-2 text-sm'>
              <Link href={`/dashboard/my-work/${subtask.id}`} className='min-w-0 truncate hover:underline'>
                {subtask.title}
              </Link>
              <div className='flex shrink-0 items-center gap-2'>
                {subtask.assigneeName && (
                  <span className='text-muted-foreground text-xs'>{subtask.assigneeName}</span>
                )}
                <Badge variant='outline'>{TASK_STATUS_LABEL[subtask.status]}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form onSubmit={handleAdd} className='flex gap-2'>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='New subtask title'
            maxLength={200}
          />
          <Button type='submit' size='sm' disabled={isPending || !title.trim()}>
            <Icons.add />
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
