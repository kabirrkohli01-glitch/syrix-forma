import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths
} from 'date-fns';
import Link from 'next/link';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { TASK_PRIORITY_VARIANT } from '@/features/tasks/utils/labels';
import type { TaskListRow } from './tasks-table';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PER_DAY = 3;

function monthQuery(month: Date, delta: number) {
  const target = delta > 0 ? addMonths(month, delta) : subMonths(month, -delta);
  return `month=${format(target, 'yyyy-MM')}`;
}

export function TaskCalendar({ tasks, month }: { tasks: TaskListRow[]; month: Date }) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const withDueDate = tasks.filter((t): t is TaskListRow & { dueDate: Date } => t.dueDate !== null);

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <h2 className='text-lg font-semibold'>{format(month, 'MMMM yyyy')}</h2>
        <div className='flex items-center gap-1'>
          <Button
            variant='outline'
            size='icon-sm'
            render={<Link href={`?${monthQuery(month, -1)}`} aria-label='Previous month' />}
          >
            <Icons.chevronLeft />
          </Button>
          <Button variant='outline' size='sm' render={<Link href='?' aria-label='Jump to the current month' />}>
            Today
          </Button>
          <Button
            variant='outline'
            size='icon-sm'
            render={<Link href={`?${monthQuery(month, 1)}`} aria-label='Next month' />}
          >
            <Icons.chevronRight />
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-xs'>
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className='bg-muted/50 p-2 text-center font-medium'>
            {label}
          </div>
        ))}
        {days.map((day) => {
          const dayTasks = withDueDate.filter((t) => isSameDay(t.dueDate, day));
          const overflow = dayTasks.length - MAX_PER_DAY;
          return (
            <div
              key={day.toISOString()}
              className={`bg-card min-h-24 p-1.5 ${isSameMonth(day, month) ? '' : 'opacity-40'}`}
            >
              <span className={isToday(day) ? 'inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground' : ''}>
                {format(day, 'd')}
              </span>
              <div className='mt-1 flex flex-col gap-0.5'>
                {dayTasks.slice(0, MAX_PER_DAY).map((task) => (
                  <Link
                    key={task.id}
                    href={`/dashboard/my-work/${task.id}`}
                    className='truncate rounded px-1 py-0.5 hover:underline'
                    title={task.title}
                  >
                    <span
                      className={`mr-1 inline-block size-1.5 rounded-full ${
                        TASK_PRIORITY_VARIANT[task.priority] === 'destructive' ? 'bg-destructive' : 'bg-primary'
                      }`}
                    />
                    {task.title}
                  </Link>
                ))}
                {overflow > 0 && <span className='text-muted-foreground px-1'>+{overflow} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
