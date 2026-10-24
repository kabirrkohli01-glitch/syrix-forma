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
import { PROJECT_STATUS_LABEL } from '@/lib/status-colors';
import { updateProject } from '@/features/projects/actions';
import { projectStatusValues } from '@/features/projects/utils/schemas';

export function EditProjectDialog({
  projectId,
  currentName,
  currentStatus,
  currentTeam,
  canChangeTeam
}: {
  projectId: string;
  currentName: string;
  currentStatus: (typeof projectStatusValues)[number];
  currentTeam: string;
  canChangeTeam: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(currentName);
  const [status, setStatus] = useState<(typeof projectStatusValues)[number]>(currentStatus);
  const [team, setTeam] = useState(currentTeam);

  function handleOpenChange(next: boolean) {
    if (next) {
      // Reset to the current server-known values each time the dialog opens, so a cancel
      // followed by a reopen never shows a stale edit from earlier in the session.
      setName(currentName);
      setStatus(currentStatus);
      setTeam(currentTeam);
    }
    setOpen(next);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    startTransition(async () => {
      try {
        await updateProject(projectId, {
          name: name.trim(),
          status,
          ...(canChangeTeam && team.trim() !== currentTeam ? { team: team.trim() } : {})
        });
        toast.success('Project updated');
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update project');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant='outline' size='sm' />}>
        <Icons.edit />
        Edit
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>Update this project's details.</DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-3 py-4'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='edit-project-name'>Name</Label>
              <Input
                id='edit-project-name'
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='edit-project-status'>Status</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as (typeof projectStatusValues)[number])}
              >
                <SelectTrigger id='edit-project-status' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projectStatusValues.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PROJECT_STATUS_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canChangeTeam && (
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='edit-project-team'>Team</Label>
                <Input
                  id='edit-project-team'
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  maxLength={200}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type='submit' disabled={isPending}>
              {isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
