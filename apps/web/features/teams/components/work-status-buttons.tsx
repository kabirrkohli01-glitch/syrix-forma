'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { setWorkStatus } from '@/features/teams/actions';
import { workStatusValues } from '@/features/teams/utils/schemas';

const BUTTONS = [
  { status: workStatusValues[0], label: 'Start working', icon: Icons.login },
  { status: workStatusValues[1], label: 'Take a break', icon: Icons.coffee },
  { status: workStatusValues[2], label: 'Log off for the day', icon: Icons.logout }
] as const;

export function WorkStatusButtons({ currentStatus }: { currentStatus: (typeof workStatusValues)[number] }) {
  const [isPending, startTransition] = useTransition();

  function handleClick(status: (typeof workStatusValues)[number]) {
    if (status === currentStatus || isPending) return;
    startTransition(async () => {
      try {
        await setWorkStatus({ status });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not update your status');
      }
    });
  }

  return (
    <div className='flex flex-wrap gap-2'>
      {BUTTONS.map(({ status, label, icon: Icon }) => (
        <Button
          key={status}
          type='button'
          variant={status === currentStatus ? 'default' : 'outline'}
          size='sm'
          disabled={isPending}
          onClick={() => handleClick(status)}
        >
          <Icon className='size-4' />
          {label}
        </Button>
      ))}
    </div>
  );
}
