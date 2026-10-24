'use client';

import { format, isPast, isToday } from 'date-fns';
import Link from 'next/link';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Icons } from '@/components/icons';
import { completeTask } from '@/features/tasks/actions';
import { TASK_PRIORITY_VARIANT } from '@/features/tasks/utils/labels';
import type { TaskListRow } from './tasks-table';

function TaskRow({ task }: { task: TaskListRow }) {
  const [isPending, startTransition] = useTransition();

  function handleComplete() {
    startTransition(async () => {
      try {
        await completeTask(task.id);
        toast.success('Task completed');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to complete task');
      }
    });
  }

  return (
    <li className='flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm'>
      <div className='flex min-w-0 items-center gap-2'>
        <Button variant='ghost' size='icon-sm' disabled={isPending} onClick={handleComplete} aria-label='Mark complete'>
          <Icons.circle />
        </Button>
        <Link href={`/dashboard/my-work/${task.id}`} className='min-w-0 truncate hover:underline'>
          {task.title}
        </Link>
      </div>
      <Badge variant={TASK_PRIORITY_VARIANT[task.priority]}>{task.priority}</Badge>
    </li>
  );
}

// Personal, not team-scoped — "what do I need to do today," so this only ever shows tasks
// assigned to the viewer, regardless of role/scope (unlike List/Board, which show everything the
// caller's role permits).
export function MyDayView({ tasks, currentEmployeeId }: { tasks: TaskListRow[]; currentEmployeeId: string }) {
  const mine = tasks.filter((t) => t.assigneeId === currentEmployeeId && t.status !== 'done');
  const overdue = mine.filter((t) => t.dueDate && isPast(t.dueDate) && !isToday(t.dueDate));
  const dueToday = mine.filter((t) => t.dueDate && isToday(t.dueDate));
  const unscheduled = mine.filter((t) => !t.dueDate);

  if (mine.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.sun />
          </EmptyMedia>
          <EmptyTitle>Nothing on your plate</EmptyTitle>
          <EmptyDescription>Tasks assigned to you will show up here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className='flex flex-col gap-6'>
      <p className='text-muted-foreground text-sm'>{format(new Date(), 'EEEE, MMMM d')}</p>
      {overdue.length > 0 && (
        <div className='flex flex-col gap-2'>
          <h3 className='text-destructive text-sm font-semibold'>Overdue</h3>
          <ul className='flex flex-col gap-2'>
            {overdue.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </div>
      )}
      {dueToday.length > 0 && (
        <div className='flex flex-col gap-2'>
          <h3 className='text-sm font-semibold'>Due today</h3>
          <ul className='flex flex-col gap-2'>
            {dueToday.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </div>
      )}
      {unscheduled.length > 0 && (
        <div className='flex flex-col gap-2'>
          <h3 className='text-sm font-semibold'>No due date</h3>
          <ul className='flex flex-col gap-2'>
            {unscheduled.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
