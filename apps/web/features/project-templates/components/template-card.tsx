'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  addTemplateMilestone,
  addTemplateTask,
  deleteProjectTemplate,
  removeTemplateMilestone,
  removeTemplateTask
} from '@/features/project-templates/actions';

export type TemplateTaskRow = { id: string; title: string; relativeDueDays: number | null; priority: string };
export type TemplateMilestoneRow = { id: string; title: string; relativeDueDays: number | null };

export function TemplateCard({
  templateId,
  name,
  serviceLine,
  taskRows,
  milestoneRows
}: {
  templateId: string;
  name: string;
  serviceLine: string | null;
  taskRows: TemplateTaskRow[];
  milestoneRows: TemplateMilestoneRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDays, setTaskDays] = useState('');
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDays, setMilestoneDays] = useState('');

  function handleAddTask(event: React.FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim()) return;
    startTransition(async () => {
      try {
        await addTemplateTask(templateId, {
          title: taskTitle.trim(),
          relativeDueDays: taskDays ? Number(taskDays) : undefined
        });
        setTaskTitle('');
        setTaskDays('');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add task');
      }
    });
  }

  function handleAddMilestone(event: React.FormEvent) {
    event.preventDefault();
    if (!milestoneTitle.trim()) return;
    startTransition(async () => {
      try {
        await addTemplateMilestone(templateId, {
          title: milestoneTitle.trim(),
          relativeDueDays: milestoneDays ? Number(milestoneDays) : undefined
        });
        setMilestoneTitle('');
        setMilestoneDays('');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add milestone');
      }
    });
  }

  function handleDeleteTemplate() {
    startTransition(async () => {
      try {
        await deleteProjectTemplate(templateId);
        toast.success('Template deleted');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to delete template');
      }
    });
  }

  function handleRemoveTask(taskId: string) {
    startTransition(async () => {
      try {
        await removeTemplateTask(taskId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove task');
      }
    });
  }

  function handleRemoveMilestone(milestoneId: string) {
    startTransition(async () => {
      try {
        await removeTemplateMilestone(milestoneId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove milestone');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-start justify-between gap-4'>
          <div>
            <CardTitle>{name}</CardTitle>
            <CardDescription>{serviceLine ?? 'No service line set'}</CardDescription>
          </div>
          <Button variant='ghost' size='icon-sm' disabled={isPending} onClick={handleDeleteTemplate} aria-label='Delete template'>
            <Icons.trash className='size-3.5' />
          </Button>
        </div>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div className='flex flex-col gap-2'>
          <p className='text-sm font-medium'>Tasks</p>
          {taskRows.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No template tasks yet.</p>
          ) : (
            <ul className='flex flex-col gap-1.5'>
              {taskRows.map((t) => (
                <li key={t.id} className='flex items-center justify-between gap-2 text-sm'>
                  <span className='truncate'>{t.title}</span>
                  <div className='flex shrink-0 items-center gap-2'>
                    <Badge variant='outline'>
                      {t.relativeDueDays === null ? 'No due date' : `Day ${t.relativeDueDays}`}
                    </Badge>
                    <Button
                      size='icon-sm'
                      variant='ghost'
                      disabled={isPending}
                      onClick={() => handleRemoveTask(t.id)}
                      aria-label='Remove template task'
                    >
                      <Icons.close className='size-3.5' />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleAddTask} className='flex gap-2'>
            <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder='Task title' maxLength={200} />
            <Input
              value={taskDays}
              onChange={(e) => setTaskDays(e.target.value)}
              placeholder='Day #'
              type='number'
              min={0}
              className='w-24'
            />
            <Button type='submit' size='sm' disabled={isPending || !taskTitle.trim()}>
              <Icons.add />
            </Button>
          </form>
        </div>

        <div className='flex flex-col gap-2 border-t pt-4'>
          <p className='text-sm font-medium'>Milestones</p>
          {milestoneRows.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No template milestones yet.</p>
          ) : (
            <ul className='flex flex-col gap-1.5'>
              {milestoneRows.map((m) => (
                <li key={m.id} className='flex items-center justify-between gap-2 text-sm'>
                  <span className='truncate'>{m.title}</span>
                  <div className='flex shrink-0 items-center gap-2'>
                    <Badge variant='outline'>
                      {m.relativeDueDays === null ? 'No due date' : `Day ${m.relativeDueDays}`}
                    </Badge>
                    <Button
                      size='icon-sm'
                      variant='ghost'
                      disabled={isPending}
                      onClick={() => handleRemoveMilestone(m.id)}
                      aria-label='Remove template milestone'
                    >
                      <Icons.close className='size-3.5' />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleAddMilestone} className='flex gap-2'>
            <Input
              value={milestoneTitle}
              onChange={(e) => setMilestoneTitle(e.target.value)}
              placeholder='Milestone title'
              maxLength={200}
            />
            <Input
              value={milestoneDays}
              onChange={(e) => setMilestoneDays(e.target.value)}
              placeholder='Day #'
              type='number'
              min={0}
              className='w-24'
            />
            <Button type='submit' size='sm' disabled={isPending || !milestoneTitle.trim()}>
              <Icons.add />
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
