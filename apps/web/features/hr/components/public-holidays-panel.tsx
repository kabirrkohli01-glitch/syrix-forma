'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListGroup, ListRow } from '@/components/ui/list-group';
import { addPublicHoliday, removePublicHoliday } from '@/features/hr/settings-actions';
import { hrErrorMessage } from '@/features/hr/utils/errors';

export type PublicHolidayRow = {
  id: string;
  date: string;
  name: string;
  region: string;
};

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function AddHolidayDialog({ defaultDate }: { defaultDate: string }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [date, setDate] = React.useState(defaultDate);
  const [name, setName] = React.useState('');
  const [region, setRegion] = React.useState('England and Wales');

  function save() {
    startTransition(async () => {
      try {
        await addPublicHoliday({ date, name, region });
        toast.success(`${name} added`);
        setName('');
        setOpen(false);
      } catch (error) {
        toast.error(hrErrorMessage(error));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size='sm' />}>
        <Icons.add aria-hidden />
        Add a public holiday
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Add a public holiday</DialogTitle>
          <DialogDescription>
            A date listed here is never charged to anyone&apos;s allowance when their leave spans
            it. Bank holidays have to be entered — the Hub does not fetch them from anywhere,
            because which ones apply depends on where people work.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='holiday-date'>Date</Label>
            <Input
              id='holiday-date'
              type='date'
              value={date}
              disabled={pending}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='holiday-name'>Name</Label>
            <Input
              id='holiday-name'
              value={name}
              maxLength={200}
              placeholder='e.g. Early May bank holiday'
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='holiday-region'>Applies to</Label>
            <Input
              id='holiday-region'
              value={region}
              maxLength={100}
              disabled={pending}
              onChange={(e) => setRegion(e.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              Free text, so Scotland and Northern Ireland can have their own entries on the same
              date without one replacing the other.
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button onClick={save} disabled={pending || !date || name.trim().length === 0}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveButton({ holiday }: { holiday: PublicHolidayRow }) {
  const [pending, startTransition] = React.useTransition();

  function remove() {
    startTransition(async () => {
      try {
        await removePublicHoliday(holiday.id);
        toast.success(`${holiday.name} removed`);
      } catch (error) {
        toast.error(hrErrorMessage(error));
      }
    });
  }

  return (
    <Button variant='ghost' size='sm' onClick={remove} disabled={pending}>
      Remove
    </Button>
  );
}

export function PublicHolidaysPanel({
  holidays,
  leaveYearStart,
  leaveYearLabel
}: {
  holidays: PublicHolidayRow[];
  leaveYearStart: string;
  leaveYearLabel: string;
}) {
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2 px-1'>
        <div>
          <h2 className='text-sm font-medium'>Public holidays</h2>
          <p className='text-muted-foreground text-xs'>
            In the leave year starting {leaveYearLabel}. Leave spanning one of these days is not
            charged for it.
          </p>
        </div>
        <AddHolidayDialog defaultDate={leaveYearStart} />
      </div>

      {holidays.length === 0 ? (
        <ListGroup>
          <div className='p-4'>
            <p className='text-sm font-medium'>None recorded for this leave year</p>
            <p className='text-muted-foreground text-xs'>
              Until they are added, somebody booking the week of a bank holiday is charged five
              days rather than four.
            </p>
          </div>
        </ListGroup>
      ) : (
        <ListGroup>
          {holidays.map((holiday) => (
            <ListRow
              key={holiday.id}
              label={holiday.name}
              description={`${formatDate(holiday.date)} · ${holiday.region}`}
              action={<RemoveButton holiday={holiday} />}
            />
          ))}
        </ListGroup>
      )}
    </div>
  );
}
