'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createTask } from '@/features/tasks/actions';
import { taskPriorityValues } from '@/features/tasks/utils/schemas';

const NONE = '__none__';

export type SelectOption = { id: string; name: string };

export function CreateTaskDialog({
  assignableEmployees,
  clients,
  projects
}: {
  assignableEmployees: SelectOption[];
  clients: SelectOption[];
  projects: SelectOption[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<(typeof taskPriorityValues)[number]>('medium');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState(NONE);
  const [clientId, setClientId] = useState(NONE);
  const [projectId, setProjectId] = useState(NONE);

  function reset() {
    setTitle('');
    setDescription('');
    setPriority('medium');
    setDueDate('');
    setAssigneeId(NONE);
    setClientId(NONE);
    setProjectId(NONE);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    startTransition(async () => {
      try {
        await createTask({
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          dueDate: dueDate ? new Date(dueDate) : undefined,
          assigneeId: assigneeId === NONE ? undefined : assigneeId,
          clientId: clientId === NONE ? undefined : clientId,
          projectId: projectId === NONE ? undefined : projectId
        });
        toast.success('Task created');
        reset();
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to create task');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Icons.add />
        New Task
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
            <DialogDescription>Create a task and optionally assign it.</DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-3 py-4'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='task-title'>Title</Label>
              <Input
                id='task-title'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='task-description'>Description</Label>
              <Textarea
                id='task-description'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
              />
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='flex flex-col gap-1.5'>
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {taskPriorityValues.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='task-due-date'>Due date</Label>
                <Input
                  id='task-due-date'
                  type='date'
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label>Assign to</Label>
              <Select value={assigneeId} onValueChange={(v) => setAssigneeId(v ?? NONE)}>
                <SelectTrigger className='w-full'>
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
            </div>
            {clients.length > 0 && (
              <div className='flex flex-col gap-1.5'>
                <Label>Client</Label>
                <Select value={clientId} onValueChange={(v) => setClientId(v ?? NONE)}>
                  <SelectTrigger className='w-full'>
                    <SelectValue placeholder='None' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {projects.length > 0 && (
              <div className='flex flex-col gap-1.5'>
                <Label>Project</Label>
                <Select value={projectId} onValueChange={(v) => setProjectId(v ?? NONE)}>
                  <SelectTrigger className='w-full'>
                    <SelectValue placeholder='None' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type='submit' disabled={isPending}>
              {isPending ? 'Creating…' : 'Create task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
