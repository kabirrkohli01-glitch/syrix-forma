'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { addTaskDependency, removeTaskDependency } from '@/features/tasks/dependencies-actions';
import { TASK_STATUS_LABEL } from '@/features/tasks/utils/labels';
import type { taskStatusValues } from '@/features/tasks/utils/schemas';

export type DependencyRow = {
  id: string;
  dependsOnTaskId: string;
  dependsOnTitle: string;
  dependsOnStatus: (typeof taskStatusValues)[number];
};

export function DependenciesCard({
  taskId,
  dependencies,
  candidateTasks,
  canManage
}: {
  taskId: string;
  dependencies: DependencyRow[];
  candidateTasks: { id: string; title: string }[];
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<string>('');
  const [isPending, startTransition] = useTransition();

  const linked = new Set(dependencies.map((d) => d.dependsOnTaskId));
  const options = candidateTasks.filter((t) => !linked.has(t.id));

  function handleAdd() {
    if (!selected) return;
    startTransition(async () => {
      try {
        await addTaskDependency(taskId, { dependsOnTaskId: selected });
        setSelected('');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add dependency');
      }
    });
  }

  function handleRemove(dependencyId: string) {
    startTransition(async () => {
      try {
        await removeTaskDependency(dependencyId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove dependency');
      }
    });
  }

  return (
    <div className='flex flex-col gap-3'>
      {dependencies.length === 0 ? (
        <p className='text-muted-foreground text-sm'>This task doesn&apos;t depend on anything.</p>
      ) : (
        <ul className='flex flex-col gap-2'>
          {dependencies.map((dep) => (
            <li key={dep.id} className='flex items-center justify-between gap-2 text-sm'>
              <Link href={`/dashboard/my-work/${dep.dependsOnTaskId}`} className='min-w-0 truncate hover:underline'>
                {dep.dependsOnTitle}
              </Link>
              <div className='flex shrink-0 items-center gap-2'>
                <Badge variant='outline'>{TASK_STATUS_LABEL[dep.dependsOnStatus]}</Badge>
                {canManage && (
                  <Button
                    size='icon-sm'
                    variant='ghost'
                    disabled={isPending}
                    onClick={() => handleRemove(dep.id)}
                    aria-label='Remove dependency'
                  >
                    <Icons.close className='size-3.5' />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && options.length > 0 && (
        <div className='flex gap-2'>
          <Select value={selected} onValueChange={(v) => setSelected(v ?? '')}>
            <SelectTrigger className='w-full'>
              <SelectValue placeholder='Depends on…' />
            </SelectTrigger>
            <SelectContent>
              {options.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size='sm' disabled={isPending || !selected} onClick={handleAdd}>
            <Icons.link className='size-3.5' />
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
