'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { IconFlag } from '@tabler/icons-react';
import { format, isPast, isToday } from 'date-fns';
import Link from 'next/link';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/table/data-table';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { useDataTable } from '@/hooks/use-data-table';
import { archiveTask, assignTask, completeTask } from '@/features/tasks/actions';
import type { SelectOption } from '@/features/tasks/components/create-task-dialog';
import { TASK_PRIORITY_TONE, TASK_STATUS_LABEL, TASK_STATUS_TONE } from '@/features/tasks/utils/labels';
import { taskPriorityValues, taskStatusValues } from '@/features/tasks/utils/schemas';
import { TONE_CHIP_CLASSES, type Tone } from '@/lib/status-colors';
import { cn } from '@/lib/utils';

// Same palette as TONE_CHIP_CLASSES (lib/status-colors.ts), text color only — used for the
// Priority column's flag icon, which carries the tone without a filled background.
const TONE_ICON_TEXT: Record<Tone, string> = {
  neutral: 'text-primary',
  destructive: 'text-destructive',
  caution: 'text-chart-5',
  info: 'text-chart-2',
  success: 'text-chart-4',
  muted: 'text-muted-foreground'
};

export type TaskListRow = {
  id: string;
  title: string;
  status: (typeof taskStatusValues)[number];
  priority: (typeof taskPriorityValues)[number];
  dueDate: Date | null;
  assigneeId: string | null;
  assigneeName: string | null;
  clientName: string | null;
  projectName: string | null;
};

const NONE = '__none__';

function AssigneeCell({
  task,
  assignableEmployees
}: {
  task: TaskListRow;
  assignableEmployees: SelectOption[];
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string | null) {
    startTransition(async () => {
      try {
        await assignTask(task.id, { assigneeId: !value || value === NONE ? null : value });
        toast.success('Task reassigned');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to reassign task');
      }
    });
  }

  return (
    <Select value={task.assigneeId ?? NONE} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger size='sm' className='w-40'>
        <SelectValue placeholder='Unassigned' />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Unassigned</SelectItem>
        {assignableEmployees.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TaskRowActions({ task }: { task: TaskListRow }) {
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

  function handleArchive() {
    startTransition(async () => {
      try {
        await archiveTask(task.id);
        toast.success('Task archived');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to archive task');
      }
    });
  }

  return (
    <div className='flex items-center gap-1'>
      {task.status !== 'done' && (
        <Button variant='ghost' size='icon-sm' onClick={handleComplete} disabled={isPending} aria-label='Mark complete'>
          <Icons.check />
        </Button>
      )}
      <Button variant='ghost' size='icon-sm' onClick={handleArchive} disabled={isPending} aria-label='Archive task'>
        <Icons.trash />
      </Button>
    </div>
  );
}

function buildColumns(assignableEmployees: SelectOption[]): ColumnDef<TaskListRow>[] {
  return [
    {
      accessorKey: 'title',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Title' />,
      cell: ({ row }) => {
        const task = row.original;
        const context = [task.clientName, task.projectName].filter(Boolean).join(' · ');
        return (
          <div className='min-w-0'>
            <Link href={`/dashboard/my-work/${task.id}`} className='block truncate font-medium hover:underline'>
              {task.title}
            </Link>
            {context && <p className='text-muted-foreground truncate text-xs'>{context}</p>}
          </div>
        );
      }
    },
    {
      id: 'assignee',
      accessorKey: 'assigneeName',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Assignee' />,
      cell: ({ row }) => (
        <AssigneeCell task={row.original} assignableEmployees={assignableEmployees} />
      )
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Status' />,
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <Badge variant='outline' className={cn('border-transparent', TONE_CHIP_CLASSES[TASK_STATUS_TONE[status]])}>
            {TASK_STATUS_LABEL[status]}
          </Badge>
        );
      },
      enableColumnFilter: true,
      meta: {
        label: 'Status',
        variant: 'multiSelect',
        options: taskStatusValues.map((s) => ({ label: TASK_STATUS_LABEL[s], value: s }))
      }
    },
    {
      accessorKey: 'priority',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Priority' />,
      cell: ({ row }) => {
        const priority = row.original.priority;
        return (
          <span className='flex items-center justify-center' title={priority}>
            <IconFlag size={15} className={TONE_ICON_TEXT[TASK_PRIORITY_TONE[priority]]} fill='currentColor' />
            <span className='sr-only'>{priority}</span>
          </span>
        );
      },
      enableColumnFilter: true,
      meta: {
        label: 'Priority',
        variant: 'multiSelect',
        options: taskPriorityValues.map((p) => ({ label: p, value: p }))
      }
    },
    {
      accessorKey: 'dueDate',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Due date' />,
      cell: ({ row }) => {
        const dueDate = row.original.dueDate;
        if (!dueDate) return <span className='text-muted-foreground'>—</span>;
        const overdue = isPast(dueDate) && !isToday(dueDate) && row.original.status !== 'done';
        return (
          <span className={overdue ? 'font-medium text-destructive' : undefined}>
            {format(dueDate, 'MMM d, yyyy')}
          </span>
        );
      }
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => <TaskRowActions task={row.original} />
    }
  ];
}

export function TasksTable({
  data,
  pageCount,
  assignableEmployees
}: {
  data: TaskListRow[];
  pageCount: number;
  assignableEmployees: SelectOption[];
}) {
  const columns = buildColumns(assignableEmployees);
  const { table } = useDataTable({
    columns,
    data,
    pageCount,
    initialState: { sorting: [{ id: 'dueDate', desc: false }] }
  });

  if (data.length === 0 && pageCount <= 1) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.checks />
          </EmptyMedia>
          <EmptyTitle>No tasks yet</EmptyTitle>
          <EmptyDescription>Create the first task to get started.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}
