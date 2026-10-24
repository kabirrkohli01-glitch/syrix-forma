'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { setKillSwitch } from '@/features/automations/actions';

export function KillSwitchToggle({ enabled }: { enabled: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      try {
        await setKillSwitch(checked);
        toast.success(checked ? 'Automations turned on' : 'All automations stopped');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update the kill-switch');
      }
    });
  }

  return (
    <div className='flex items-center gap-3'>
      <Switch id='kill-switch' checked={enabled} onCheckedChange={handleChange} disabled={isPending} />
      <Label htmlFor='kill-switch' className='text-sm font-medium'>
        {enabled ? 'Automations are running' : 'All automations are stopped'}
      </Label>
    </div>
  );
}
