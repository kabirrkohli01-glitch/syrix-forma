'use client';

import { format } from 'date-fns';
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
import { createProjectFromTemplate } from '@/features/project-templates/actions';
import { createProject } from '@/features/projects/actions';
import type { SelectOption } from '@/features/tasks/components/create-task-dialog';

const NO_TEMPLATE = '__none__';

export type ProjectTemplateOption = { id: string; name: string; serviceLine: string | null };

export function CreateProjectDialog({
  clients,
  templates
}: {
  clients: SelectOption[];
  templates: ProjectTemplateOption[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [templateId, setTemplateId] = useState(NO_TEMPLATE);
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  function reset() {
    setName('');
    setTemplateId(NO_TEMPLATE);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !clientId) {
      toast.error('Name and client are required');
      return;
    }

    startTransition(async () => {
      try {
        if (templateId === NO_TEMPLATE) {
          await createProject({ name: name.trim(), clientId });
        } else {
          await createProjectFromTemplate({
            templateId,
            name: name.trim(),
            clientId,
            startDate: new Date(startDate)
          });
        }
        toast.success('Project created');
        reset();
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to create project');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button disabled={clients.length === 0} />}>
        <Icons.add />
        New Project
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>Standing up a new project under an existing client.</DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-3 py-4'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='project-name'>Name</Label>
              <Input
                id='project-name'
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label>Client</Label>
              <Select value={clientId} onValueChange={(v) => setClientId(v ?? '')}>
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder='Select a client' />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {templates.length > 0 && (
              <div className='flex flex-col gap-1.5'>
                <Label>Start from template</Label>
                <Select value={templateId} onValueChange={(v) => setTemplateId(v ?? NO_TEMPLATE)}>
                  <SelectTrigger className='w-full'>
                    <SelectValue placeholder='None' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TEMPLATE}>None — blank project</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.serviceLine ? ` (${t.serviceLine})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {templateId !== NO_TEMPLATE && (
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='project-start-date'>Start date</Label>
                <Input
                  id='project-start-date'
                  type='date'
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <p className='text-muted-foreground text-xs'>
                  The template&apos;s tasks and milestones will get due dates relative to this date.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type='submit' disabled={isPending}>
              {isPending ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
