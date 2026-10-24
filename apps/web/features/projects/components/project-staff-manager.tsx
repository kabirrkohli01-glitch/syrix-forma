'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { assignStaffToProject, removeStaffFromProject } from '@/features/projects/actions';

export type StaffedEmployee = { id: string; name: string };

/** First letter of the first two words — "Kabir Kohli" -> "KK", "Kabir" -> "KA". Mirrors
 *  features/teams/components/status-board.tsx's identical helper. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ProjectStaffManager({
  projectId,
  staffed,
  addableEmployees,
  canManage
}: {
  projectId: string;
  staffed: StaffedEmployee[];
  addableEmployees: StaffedEmployee[];
  canManage: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(null);

  function handleAdd() {
    if (!selected) return;
    startTransition(async () => {
      try {
        await assignStaffToProject(projectId, { employeeId: selected });
        toast.success('Staff added');
        setSelected(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add staff');
      }
    });
  }

  function handleRemove(employeeId: string) {
    startTransition(async () => {
      try {
        await removeStaffFromProject(projectId, { employeeId });
        toast.success('Staff removed');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove staff');
      }
    });
  }

  return (
    <div className='flex flex-col gap-3'>
      {staffed.length === 0 ? (
        <p className='text-muted-foreground text-sm'>No staff assigned yet.</p>
      ) : (
        <ul className='flex flex-col gap-2'>
          {staffed.map((employee) => (
            <li key={employee.id} className='flex items-center justify-between gap-2 text-sm'>
              <span>{employee.name}</span>
              {canManage && (
                <Button
                  variant='ghost'
                  size='icon-sm'
                  disabled={isPending}
                  onClick={() => handleRemove(employee.id)}
                  aria-label={`Remove ${employee.name}`}
                >
                  <Icons.close />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && addableEmployees.length > 0 && (
        <div className='flex items-center gap-2 border-t pt-3'>
          <Select value={selected ?? undefined} onValueChange={setSelected}>
            <SelectTrigger className='w-full'>
              <SelectValue placeholder='Add an employee…' />
            </SelectTrigger>
            <SelectContent>
              {addableEmployees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size='sm' disabled={!selected || isPending} onClick={handleAdd}>
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
