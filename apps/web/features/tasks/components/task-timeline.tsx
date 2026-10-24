import { addWeeks, endOfWeek, format, isPast, isThisWeek, isToday, isTomorrow } from 'date-fns';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Icons } from '@/components/icons';
import { TASK_PRIORITY_VARIANT, TASK_STATUS_LABEL } from '@/features/tasks/utils/labels';
import type { TaskListRow } from './tasks-table';

type Bucket = { label: string; tasks: TaskListRow[] };

// Grouped chronologically rather than a full drag-to-reschedule Gantt chart — the build plan
// asks for a Timeline view of My Work's own tasks, not a project-planning tool (that's the
// separate ProjectMilestones concept). This answers "what's coming up and in what order" without
// a new charting dependency.
function bucketize(tasks: TaskListRow[]): Bucket[] {
  const withDate = tasks.filter((t) => t.dueDate !== null && t.status !== 'done');
  const noDate = tasks.filter((t) => t.dueDate === null && t.status !== 'done');
  const nextWeekEnd = endOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 1 });

  const buckets: Bucket[] = [
    { label: 'Overdue', tasks: [] },
    { label: 'Today', tasks: [] },
    { label: 'Tomorrow', tasks: [] },
    { label: 'This week', tasks: [] },
    { label: 'Next week', tasks: [] },
    { label: 'Later', tasks: [] }
  ];

  for (const task of withDate) {
    const due = task.dueDate!;
    if (isPast(due) && !isToday(due)) buckets[0].tasks.push(task);
    else if (isToday(due)) buckets[1].tasks.push(task);
    else if (isTomorrow(due)) buckets[2].tasks.push(task);
    else if (isThisWeek(due, { weekStartsOn: 1 })) buckets[3].tasks.push(task);
    else if (due <= nextWeekEnd) buckets[4].tasks.push(task);
    else buckets[5].tasks.push(task);
  }

  for (const bucket of buckets) bucket.tasks.sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime());

  if (noDate.length > 0) buckets.push({ label: 'No due date', tasks: noDate });

  return buckets.filter((b) => b.tasks.length > 0);
}

export function TaskTimeline({ tasks }: { tasks: TaskListRow[] }) {
  const buckets = bucketize(tasks);

  if (buckets.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.clock />
          </EmptyMedia>
          <EmptyTitle>Nothing outstanding</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className='flex flex-col gap-6'>
      {buckets.map((bucket) => (
        <div key={bucket.label} className='flex flex-col gap-2'>
          <h3 className='text-sm font-semibold'>{bucket.label}</h3>
          <ul className='flex flex-col gap-1.5 border-l pl-4'>
            {bucket.tasks.map((task) => (
              <li key={task.id} className='flex items-center justify-between gap-2 text-sm'>
                <Link href={`/dashboard/my-work/${task.id}`} className='min-w-0 truncate hover:underline'>
                  {task.title}
                </Link>
                <div className='flex shrink-0 items-center gap-2'>
                  {task.assigneeName && (
                    <span className='text-muted-foreground text-xs'>{task.assigneeName}</span>
                  )}
                  {task.dueDate && (
                    <span className='text-muted-foreground text-xs'>{format(task.dueDate, 'MMM d')}</span>
                  )}
                  <Badge variant={TASK_PRIORITY_VARIANT[task.priority]}>{task.priority}</Badge>
                  <Badge variant='outline'>{TASK_STATUS_LABEL[task.status]}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
