'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { updateTask } from '@/features/tasks/actions';
import { recurrenceFrequencyValues, type RecurrenceRule } from '@/features/tasks/utils/schemas';

const NONE = '__none__';

export function RecurrenceEditor({
  taskId,
  rule,
  canManage
}: {
  taskId: string;
  rule: RecurrenceRule | null;
  canManage: boolean;
}) {
  const [frequency, setFrequency] = useState<(typeof recurrenceFrequencyValues)[number] | typeof NONE>(
    rule?.frequency ?? NONE
  );
  const [interval, setInterval] = useState(rule?.interval ?? 1);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      try {
        await updateTask(taskId, {
          recurrenceRule: frequency === NONE ? null : { frequency, interval: Math.max(1, interval) }
        });
        toast.success(frequency === NONE ? 'Recurrence turned off' : 'Recurrence updated');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update recurrence');
      }
    });
  }

  if (!canManage) {
    return (
      <p className='text-muted-foreground text-sm'>
        {rule ? `Repeats every ${rule.interval} ${rule.frequency.replace('ly', '')}(s)` : 'Does not repeat.'}
      </p>
    );
  }

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Select value={frequency} onValueChange={(v) => setFrequency(v as typeof frequency)}>
        <SelectTrigger className='w-40'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Does not repeat</SelectItem>
          {recurrenceFrequencyValues.map((f) => (
            <SelectItem key={f} value={f}>
              {f}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {frequency !== NONE && (
        <div className='flex items-center gap-1.5 text-sm'>
          <span className='text-muted-foreground'>every</span>
          <Input
            type='number'
            min={1}
            max={365}
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value) || 1)}
            className='w-16'
          />
          <span className='text-muted-foreground'>{frequency.replace('ly', '')}(s)</span>
        </div>
      )}
      <Button size='sm' disabled={isPending} onClick={handleSave}>
        Save
      </Button>
    </div>
  );
}
