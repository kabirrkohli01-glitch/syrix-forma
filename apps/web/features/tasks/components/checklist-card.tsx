'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { addChecklistItem, removeChecklistItem, updateChecklistItem } from '@/features/tasks/checklist-actions';

export type ChecklistItemRow = { id: string; label: string; done: boolean };

export function ChecklistCard({
  taskId,
  items,
  canManage
}: {
  taskId: string;
  items: ChecklistItemRow[];
  canManage: boolean;
}) {
  const [label, setLabel] = useState('');
  const [isPending, startTransition] = useTransition();

  const done = items.filter((i) => i.done).length;

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim()) return;
    startTransition(async () => {
      try {
        await addChecklistItem(taskId, { label: label.trim() });
        setLabel('');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add item');
      }
    });
  }

  function handleToggle(itemId: string, next: boolean) {
    startTransition(async () => {
      try {
        await updateChecklistItem(itemId, { done: next });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update item');
      }
    });
  }

  function handleRemove(itemId: string) {
    startTransition(async () => {
      try {
        await removeChecklistItem(itemId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove item');
      }
    });
  }

  return (
    <div className='flex flex-col gap-3'>
      {items.length > 0 && (
        <p className='text-muted-foreground text-xs'>
          {done} of {items.length} complete
        </p>
      )}
      {items.length === 0 ? (
        <p className='text-muted-foreground text-sm'>No checklist items yet.</p>
      ) : (
        <ul className='flex flex-col gap-2'>
          {items.map((item) => (
            <li key={item.id} className='flex items-center gap-2 text-sm'>
              <Checkbox
                checked={item.done}
                onCheckedChange={(checked) => handleToggle(item.id, checked === true)}
                disabled={!canManage || isPending}
              />
              <span className={item.done ? 'flex-1 text-muted-foreground line-through' : 'flex-1'}>
                {item.label}
              </span>
              {canManage && (
                <Button
                  size='icon-sm'
                  variant='ghost'
                  disabled={isPending}
                  onClick={() => handleRemove(item.id)}
                  aria-label='Remove item'
                >
                  <Icons.close className='size-3.5' />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form onSubmit={handleAdd} className='flex gap-2'>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='New checklist item'
            maxLength={300}
          />
          <Button type='submit' size='sm' disabled={isPending || !label.trim()}>
            <Icons.add />
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
