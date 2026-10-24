'use client';

import { format } from 'date-fns';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addMilestone, completeMilestone } from '@/features/projects/actions';

export type MilestoneRow = {
  id: string;
  title: string;
  dueDate: Date | null;
  completedAt: Date | null;
};

export function ProjectMilestones({
  projectId,
  milestones,
  canManage
}: {
  projectId: string;
  milestones: MilestoneRow[];
  canManage: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;

    startTransition(async () => {
      try {
        await addMilestone(projectId, {
          title: title.trim(),
          dueDate: dueDate ? new Date(dueDate) : undefined
        });
        toast.success('Milestone added');
        setTitle('');
        setDueDate('');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add milestone');
      }
    });
  }

  function handleComplete(milestoneId: string) {
    startTransition(async () => {
      try {
        await completeMilestone(milestoneId);
        toast.success('Milestone completed');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to complete milestone');
      }
    });
  }

  return (
    <div className='flex flex-col gap-3'>
      {milestones.length === 0 ? (
        <p className='text-muted-foreground text-sm'>No milestones yet.</p>
      ) : (
        <ul className='divide-border -my-1 flex flex-col divide-y'>
          {milestones.map((milestone) => {
            const done = !!milestone.completedAt;
            return (
              <li key={milestone.id} className='flex items-center gap-3 py-2 text-sm'>
                <button
                  type='button'
                  disabled={done || !canManage || isPending}
                  onClick={() => handleComplete(milestone.id)}
                  aria-label={done ? `${milestone.title} complete` : `Complete ${milestone.title}`}
                  className={`flex size-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    done
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input hover:border-primary disabled:hover:border-input'
                  }`}
                >
                  {done && <Icons.check className='size-3' />}
                </button>
                <p className={`min-w-0 flex-1 truncate ${done ? 'text-muted-foreground line-through' : ''}`}>
                  {milestone.title}
                </p>
                {milestone.dueDate && (
                  <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                    {format(milestone.dueDate, 'MMM d, yyyy')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canManage && (
        <form onSubmit={handleAdd} className='flex items-center gap-2 border-t pt-3'>
          <Input
            placeholder='New milestone'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className='flex-1'
          />
          <Input
            type='date'
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className='w-36'
          />
          <Button type='submit' size='sm' disabled={!title.trim() || isPending}>
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
