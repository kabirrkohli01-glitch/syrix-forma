'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { EventFormDialog, type EventOption } from './event-form-dialog';

export function ScheduleMeetingButton({
  defaultClientId,
  clientOptions,
  employeeOptions,
  projectOptions
}: {
  defaultClientId: string;
  clientOptions: EventOption[];
  employeeOptions: EventOption[];
  projectOptions: EventOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <Icons.calendar className='size-3.5' />
        Schedule meeting
      </Button>
      <EventFormDialog
        open={open}
        onOpenChange={setOpen}
        event={null}
        defaultClientId={defaultClientId}
        employeeOptions={employeeOptions}
        clientOptions={clientOptions}
        projectOptions={projectOptions}
      />
    </>
  );
}
