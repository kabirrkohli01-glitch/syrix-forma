'use client';

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import { useOptimistic, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Icons } from '@/components/icons';
import { updateTask } from '@/features/tasks/actions';
import type { TaskListRow } from '@/features/tasks/components/tasks-table';
import { TASK_PRIORITY_VARIANT, TASK_STATUS_LABEL } from '@/features/tasks/utils/labels';
import { taskStatusValues } from '@/features/tasks/utils/schemas';

function TaskCard({ task }: { task: TaskListRow }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: CSS.Translate.toString(transform) }}
      className='cursor-grab touch-none rounded-lg border bg-card p-3 text-sm active:cursor-grabbing'
      data-dragging={isDragging || undefined}
    >
      <Link
        href={`/dashboard/my-work/${task.id}`}
        onPointerDown={(e) => e.stopPropagation()}
        className='mb-2 block truncate font-medium hover:underline'
      >
        {task.title}
      </Link>
      <div className='flex items-center justify-between gap-2'>
        <Badge variant={TASK_PRIORITY_VARIANT[task.priority]}>{task.priority}</Badge>
        {task.assigneeName && (
          <span className='text-muted-foreground truncate text-xs'>{task.assigneeName}</span>
        )}
      </div>
    </div>
  );
}

function BoardColumn({
  status,
  tasksInColumn
}: {
  status: TaskListRow['status'];
  tasksInColumn: TaskListRow[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-xl border bg-muted/30 p-2 ${isOver ? 'ring-2 ring-primary' : ''}`}
    >
      <div className='flex items-center justify-between px-1 py-1'>
        <span className='text-sm font-medium'>{TASK_STATUS_LABEL[status]}</span>
        <Badge variant='secondary'>{tasksInColumn.length}</Badge>
      </div>
      <div className='flex flex-col gap-2'>
        {tasksInColumn.length === 0 ? (
          <div className='rounded-lg border border-dashed p-4 text-center'>
            <span className='text-muted-foreground text-xs'>Nothing here</span>
          </div>
        ) : (
          tasksInColumn.map((task) => <TaskCard key={task.id} task={task} />)
        )}
      </div>
    </div>
  );
}

export function TaskBoard({ data }: { data: TaskListRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [optimisticData, setOptimisticStatus] = useOptimistic(
    data,
    (state, { taskId, status }: { taskId: string; status: TaskListRow['status'] }) =>
      state.map((task) => (task.id === taskId ? { ...task, status } : task))
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const newStatus = over.id as TaskListRow['status'];
    const task = optimisticData.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    startTransition(async () => {
      setOptimisticStatus({ taskId, status: newStatus });
      try {
        await updateTask(taskId, { status: newStatus });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to move task');
      }
    });
  }

  if (data.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.kanban />
          </EmptyMedia>
          <EmptyTitle>No tasks yet</EmptyTitle>
          <EmptyDescription>Create a task from the List view to see it here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div
        className='flex flex-1 gap-3 overflow-x-auto pb-2'
        data-pending={isPending || undefined}
        aria-busy={isPending}
      >
        {taskStatusValues.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasksInColumn={optimisticData.filter((task) => task.status === status)}
          />
        ))}
      </div>
    </DndContext>
  );
}
