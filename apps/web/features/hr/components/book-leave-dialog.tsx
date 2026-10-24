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
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { previewLeaveRequest, requestLeave } from '@/features/hr/leave-actions';
import { hrErrorMessage } from '@/features/hr/utils/errors';
import { formatHalfDays } from '@/lib/hr/leave-calculation';

type LeaveTypeOption = { id: string; name: string; deductsFromAllowance: boolean };
type SubjectOption = { id: string; name: string; isSelf: boolean };

type Preview = {
  totalHalfDays: number;
  totalLabel: string;
  availableHalfDays: number;
  afterHalfDays: number;
  publicHolidaysInRange: string[];
};

const UNITS = [
  { value: 'full', label: 'Full day' },
  { value: 'am', label: 'Morning only' },
  { value: 'pm', label: 'Afternoon only' }
] as const;

export function BookLeaveDialog({
  leaveTypes,
  subjects,
  canBookForOthers
}: {
  leaveTypes: LeaveTypeOption[];
  subjects: SubjectOption[];
  canBookForOthers: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  const self = subjects.find((s) => s.isSelf);
  const [employeeId, setEmployeeId] = React.useState(self?.id ?? subjects[0]?.id ?? '');
  const [leaveTypeId, setLeaveTypeId] = React.useState(leaveTypes[0]?.id ?? '');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [startUnit, setStartUnit] = React.useState<'full' | 'am' | 'pm'>('full');
  const [endUnit, setEndUnit] = React.useState<'full' | 'am' | 'pm'>('full');
  const [reason, setReason] = React.useState('');

  const singleDay = Boolean(startDate) && startDate === endDate;
  const datesUsable = Boolean(startDate && endDate) && startDate <= endDate;

  // The preview is a convenience so nobody has to submit to find out what a booking costs.
  // requestLeave recomputes all of it server-side — this is never the check.
  //
  // Nothing is set synchronously here: the effect either starts a request or does nothing,
  // and state is only written from the resolved promise. Clearing a stale preview is done by
  // deriving it during render (`shownPreview` below) rather than by calling setState on the
  // way in, which would start a second render pass every time a date changed.
  React.useEffect(() => {
    if (!datesUsable) return;

    let cancelled = false;
    previewLeaveRequest({ employeeId, startDate, endDate, startUnit, endUnit })
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setPreviewError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(hrErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [datesUsable, employeeId, startDate, endDate, startUnit, endUnit]);

  // A preview belonging to a previous set of dates must not be shown against the current
  // ones, so it is gated on the dates still being usable rather than cleared in the effect.
  const shownPreview = datesUsable ? preview : null;
  const shownPreviewError = datesUsable ? previewError : null;

  function submit() {
    startTransition(async () => {
      try {
        const result = await requestLeave({
          employeeId: canBookForOthers ? employeeId : undefined,
          leaveTypeId,
          startDate,
          endDate,
          startUnit,
          // A single-day booking has one unit, so send the same value for both ends rather
          // than letting a stale endUnit from a previous multi-day edit apply to it.
          endUnit: singleDay ? startUnit : endUnit,
          reason: reason.trim() || undefined
        });
        toast.success(
          result.autoApproved
            ? `Booked ${formatHalfDays(result.totalHalfDays)}`
            : `Requested ${formatHalfDays(result.totalHalfDays)} — awaiting approval`
        );
        setOpen(false);
        setStartDate('');
        setEndDate('');
        setReason('');
      } catch (error) {
        toast.error(hrErrorMessage(error));
      }
    });
  }

  const canSubmit =
    Boolean(leaveTypeId && startDate && endDate && employeeId) &&
    startDate <= endDate &&
    !pending &&
    (shownPreview === null || shownPreview.totalHalfDays > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Icons.add aria-hidden />
        Book time off
      </DialogTrigger>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Book time off</DialogTitle>
          <DialogDescription>
            Weekends and public holidays are excluded automatically.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          {canBookForOthers && subjects.length > 1 && (
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='leave-subject'>For</Label>
              <NativeSelect
                className='w-full'
                id='leave-subject'
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.isSelf ? `${subject.name} (you)` : subject.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='leave-type'>Type</Label>
            <NativeSelect
              className='w-full'
              id='leave-type'
              value={leaveTypeId}
              onChange={(e) => setLeaveTypeId(e.target.value)}
            >
              {leaveTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                  {type.deductsFromAllowance ? '' : ' (does not use allowance)'}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='leave-start'>First day</Label>
              <Input
                id='leave-start'
                type='date'
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (!endDate || e.target.value > endDate) setEndDate(e.target.value);
                }}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='leave-end'>Last day</Label>
              <Input
                id='leave-end'
                type='date'
                min={startDate || undefined}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='leave-start-unit'>{singleDay ? 'How long' : 'First day'}</Label>
              <NativeSelect
                className='w-full'
                id='leave-start-unit'
                value={startUnit}
                onChange={(e) => setStartUnit(e.target.value as 'full' | 'am' | 'pm')}
              >
                {UNITS.map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {unit.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {!singleDay && (
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='leave-end-unit'>Last day</Label>
                <NativeSelect
                  className='w-full'
                  id='leave-end-unit'
                  value={endUnit}
                  onChange={(e) => setEndUnit(e.target.value as 'full' | 'am' | 'pm')}
                >
                  {UNITS.map((unit) => (
                    <option key={unit.value} value={unit.value}>
                      {unit.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='leave-reason'>Reason (optional)</Label>
            <Textarea
              id='leave-reason'
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {shownPreview && (
            <div className='bg-muted/60 rounded-xl px-3 py-2.5 text-sm'>
              <p className='font-medium'>
                {shownPreview.totalHalfDays > 0
                  ? shownPreview.totalLabel
                  : 'No working days in that range'}
              </p>
              {shownPreview.totalHalfDays > 0 && (
                <p className='text-muted-foreground text-xs'>
                  {formatHalfDays(shownPreview.afterHalfDays)} would remain afterwards
                  {shownPreview.afterHalfDays < 0 ? ' — more than your allowance' : ''}
                </p>
              )}
              {shownPreview.publicHolidaysInRange.length > 0 && (
                <p className='text-muted-foreground mt-1 text-xs'>
                  Excludes {shownPreview.publicHolidaysInRange.length} public holiday
                  {shownPreview.publicHolidaysInRange.length === 1 ? '' : 's'}.
                </p>
              )}
            </div>
          )}
          {shownPreviewError && <p className='text-destructive text-sm'>{shownPreviewError}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? 'Submitting…' : 'Submit request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
