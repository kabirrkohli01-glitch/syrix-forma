'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  acceptShiftSwap,
  addTimesheetEntry,
  approveShiftSwap,
  clock,
  createShift,
  decideTimesheet,
  publishShifts,
  requestShiftSwap,
  submitTimesheet
} from '@/features/hr/work-actions';
import { hrErrorMessage } from '@/features/hr/utils/errors';
import type { ShiftRow, TimesheetRow } from '@/features/hr/utils/work-queries';
import { formatMinuteOfDay, formatMinutes, shiftPaidMinutes } from '@/lib/hr/money';

type SubjectOption = { id: string; name: string; isSelf: boolean; isReport: boolean };

/** "09:30" from an <input type="time"> into minutes from midnight. */
function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function ClockCard({
  clockedIn,
  todayMinutes
}: {
  clockedIn: boolean;
  todayMinutes: number;
}) {
  const [pending, startTransition] = React.useTransition();

  function send(eventType: 'in' | 'out' | 'break_start' | 'break_end') {
    startTransition(async () => {
      try {
        await clock({ eventType });
        toast.success(eventType === 'in' ? 'Clocked in' : 'Recorded');
      } catch (error) {
        toast.error(hrErrorMessage(error));
      }
    });
  }

  return (
    <Card>
      <CardContent className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <p className='text-2xl font-semibold tabular-nums'>{formatMinutes(todayMinutes)}</p>
          <p className='text-muted-foreground text-xs'>
            Recorded today · {clockedIn ? 'currently clocked in' : 'not clocked in'}
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          {clockedIn ? (
            <>
              <Button variant='outline' disabled={pending} onClick={() => send('break_start')}>
                Start break
              </Button>
              <Button disabled={pending} onClick={() => send('out')}>
                Clock out
              </Button>
            </>
          ) : (
            <Button disabled={pending} onClick={() => send('in')}>
              Clock in
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function RotaList({
  shifts,
  subjects,
  canManage,
  callerId
}: {
  shifts: ShiftRow[];
  subjects: SubjectOption[];
  canManage: boolean;
  callerId: string;
}) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const unpublished = shifts.filter((shift) => !shift.publishedAt);

  function offerSwap(shiftId: string) {
    setPendingId(shiftId);
    requestShiftSwap({ shiftId })
      .then(() => toast.success('Offered to the team'))
      .catch((error: unknown) => toast.error(hrErrorMessage(error)))
      .finally(() => setPendingId(null));
  }

  return (
    <ListGroup
      label='Rota'
      note={
        canManage && unpublished.length > 0
          ? `${unpublished.length} shift${unpublished.length === 1 ? '' : 's'} not published yet — nobody has been told about ${unpublished.length === 1 ? 'it' : 'them'}.`
          : undefined
      }
    >
      {shifts.length === 0 ? (
        <ListRow
          label='No shifts scheduled'
          description='Shifts appear here once a manager publishes the rota.'
          leading={<Icons.rota aria-hidden />}
        />
      ) : (
        shifts.map((shift) => (
          <ListRow
            key={shift.id}
            label={`${shift.employeeName} · ${shift.onDate}`}
            description={`${formatMinuteOfDay(shift.startMinute)}–${formatMinuteOfDay(
              shift.endMinute
            )} · ${formatMinutes(shiftPaidMinutes(shift))} paid${
              shift.templateName ? ` · ${shift.templateName}` : ''
            }`}
            leading={<Icons.rota aria-hidden />}
            value={
              <span className='flex items-center gap-1.5'>
                {!shift.publishedAt && <Badge variant='outline'>draft</Badge>}
                {shift.swapStatus && <Badge variant='secondary'>swap {shift.swapStatus}</Badge>}
              </span>
            }
            action={
              shift.employeeId === callerId && shift.publishedAt && !shift.swapStatus ? (
                <Button
                  variant='ghost'
                  size='sm'
                  disabled={pendingId === shift.id}
                  onClick={() => offerSwap(shift.id)}
                >
                  Offer swap
                </Button>
              ) : undefined
            }
          />
        ))
      )}

      {canManage && (
        <>
          <AddShiftDialog subjects={subjects.filter((s) => s.isReport || !s.isSelf)} />
          {unpublished.length > 0 && (
            <div className='px-4 py-3'>
              <Button
                size='sm'
                onClick={() =>
                  publishShifts({ shiftIds: unpublished.map((s) => s.id) })
                    .then(() => toast.success('Rota published'))
                    .catch((error: unknown) => toast.error(hrErrorMessage(error)))
                }
              >
                Publish {unpublished.length} shift{unpublished.length === 1 ? '' : 's'}
              </Button>
            </div>
          )}
        </>
      )}
    </ListGroup>
  );
}

function AddShiftDialog({ subjects }: { subjects: SubjectOption[] }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [employeeId, setEmployeeId] = React.useState(subjects[0]?.id ?? '');
  const [onDate, setOnDate] = React.useState('');
  const [start, setStart] = React.useState('09:00');
  const [end, setEnd] = React.useState('17:00');
  const [breakMinutes, setBreakMinutes] = React.useState('60');

  if (subjects.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type='button'
            aria-label='Add a shift'
            className='hover:bg-muted/60 w-full px-4 py-3 text-start'
          />
        }
      >
        <span className='text-primary text-sm font-medium'>+ Add a shift</span>
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Add a shift</DialogTitle>
          <DialogDescription>
            Shifts stay as drafts until you publish the rota, so nobody is notified early.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='shift-who'>Who</Label>
            <NativeSelect
              className='w-full'
              id='shift-who'
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='shift-date'>Date</Label>
            <Input
              id='shift-date'
              type='date'
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
            />
          </div>
          <div className='grid grid-cols-3 gap-2'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='shift-start'>Start</Label>
              <Input
                id='shift-start'
                type='time'
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='shift-end'>End</Label>
              <Input
                id='shift-end'
                type='time'
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='shift-break'>Break (min)</Label>
              <Input
                id='shift-break'
                type='number'
                min={0}
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!employeeId || !onDate || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  const startMinute = timeToMinutes(start);
                  let endMinute = timeToMinutes(end);
                  // An end earlier than the start means the shift runs past midnight, so it
                  // is expressed as minutes into the following day rather than rejected.
                  if (endMinute <= startMinute) endMinute += 1440;

                  await createShift({
                    employeeId,
                    onDate,
                    startMinute,
                    endMinute,
                    unpaidBreakMinutes: Number(breakMinutes) || 0
                  });
                  toast.success('Shift added as a draft');
                  setOpen(false);
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Saving…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SwapQueue({
  swaps,
  callerId
}: {
  swaps: {
    id: string;
    status: string;
    requestedByEmployeeId: string;
    requestedByName: string;
    acceptedByEmployeeId: string | null;
    offeredToEmployeeId: string | null;
    onDate: string;
    startMinute: number;
    endMinute: number;
  }[];
  callerId: string;
}) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const actionable = swaps.filter(
    (swap) =>
      (swap.status === 'pending' && swap.requestedByEmployeeId !== callerId) ||
      swap.status === 'accepted'
  );

  if (actionable.length === 0) return null;

  function act(id: string, what: 'accept' | 'approve') {
    setPendingId(id);
    const run =
      what === 'accept' ? acceptShiftSwap({ swapId: id }) : approveShiftSwap({ swapId: id });
    run
      .then(() => toast.success(what === 'accept' ? 'You agreed to cover it' : 'Swap approved'))
      .catch((error: unknown) => toast.error(hrErrorMessage(error)))
      .finally(() => setPendingId(null));
  }

  return (
    <ListGroup
      label='Shift swaps'
      note='A colleague agreeing to cover is not enough on its own — a manager approves before the rota changes.'
    >
      {actionable.map((swap) => (
        <ListRow
          key={swap.id}
          label={`${swap.requestedByName} · ${swap.onDate}`}
          description={`${formatMinuteOfDay(swap.startMinute)}–${formatMinuteOfDay(swap.endMinute)}`}
          leading={<Icons.rota aria-hidden />}
          value={<Badge variant='outline'>{swap.status}</Badge>}
          action={
            swap.status === 'pending' ? (
              <Button
                size='sm'
                disabled={pendingId === swap.id}
                onClick={() => act(swap.id, 'accept')}
              >
                Cover it
              </Button>
            ) : swap.requestedByEmployeeId !== callerId &&
              swap.acceptedByEmployeeId !== callerId ? (
              <Button
                size='sm'
                disabled={pendingId === swap.id}
                onClick={() => act(swap.id, 'approve')}
              >
                Approve
              </Button>
            ) : undefined
          }
        />
      ))}
    </ListGroup>
  );
}

export function TimesheetList({
  timesheets,
  callerId
}: {
  timesheets: TimesheetRow[];
  callerId: string;
}) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  function act(id: string, what: 'submit' | 'approve' | 'reject') {
    setPendingId(id);
    const run =
      what === 'submit'
        ? submitTimesheet({ timesheetId: id })
        : decideTimesheet({
            timesheetId: id,
            decision: what === 'approve' ? 'approved' : 'rejected'
          });
    run
      .then(() => toast.success('Done'))
      .catch((error: unknown) => toast.error(hrErrorMessage(error)))
      .finally(() => setPendingId(null));
  }

  return (
    <ListGroup label='Timesheets'>
      {timesheets.length === 0 ? (
        <ListRow
          label='No hours recorded'
          description='Hours you log are grouped into a week and submitted as one sheet.'
          leading={<Icons.timesheet aria-hidden />}
        />
      ) : (
        timesheets.map((sheet) => (
          <ListRow
            key={sheet.id}
            label={`${sheet.employeeName} · week of ${sheet.weekStart}`}
            description={formatMinutes(sheet.totalMinutes)}
            leading={<Icons.timesheet aria-hidden />}
            value={<Badge variant='outline'>{sheet.status}</Badge>}
            action={
              sheet.employeeId === callerId && sheet.status === 'open' ? (
                <Button
                  size='sm'
                  disabled={pendingId === sheet.id}
                  onClick={() => act(sheet.id, 'submit')}
                >
                  Submit
                </Button>
              ) : sheet.employeeId !== callerId && sheet.status === 'submitted' ? (
                <span className='flex gap-1'>
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={pendingId === sheet.id}
                    onClick={() => act(sheet.id, 'reject')}
                  >
                    Reject
                  </Button>
                  <Button
                    size='sm'
                    disabled={pendingId === sheet.id}
                    onClick={() => act(sheet.id, 'approve')}
                  >
                    Approve
                  </Button>
                </span>
              ) : undefined
            }
          />
        ))
      )}
      <LogHoursDialog />
    </ListGroup>
  );
}

function LogHoursDialog() {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [onDate, setOnDate] = React.useState('');
  const [hours, setHours] = React.useState('');
  const [notes, setNotes] = React.useState('');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type='button'
            aria-label='Log hours'
            className='hover:bg-muted/60 w-full px-4 py-3 text-start'
          />
        }
      >
        <span className='text-primary text-sm font-medium'>+ Log hours</span>
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Log hours</DialogTitle>
          <DialogDescription>
            Added to that day&apos;s week. The week&apos;s sheet is created for you if it does not
            exist yet.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='ts-date'>Date</Label>
            <Input
              id='ts-date'
              type='date'
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='ts-hours'>Hours</Label>
            <Input
              id='ts-hours'
              type='number'
              step='0.25'
              min='0'
              max='24'
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='ts-notes'>Notes</Label>
            <Textarea
              id='ts-notes'
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!onDate || !hours || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await addTimesheetEntry({
                    onDate,
                    minutes: Math.round(Number(hours) * 60),
                    notes: notes.trim() || undefined
                  });
                  toast.success('Hours logged');
                  setOpen(false);
                  setHours('');
                  setNotes('');
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Saving…' : 'Log'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
