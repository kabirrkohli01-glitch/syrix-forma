'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
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
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { closeSickness, recordReturnToWork, recordSickness } from '@/features/hr/absence-actions';
import type { AbsenceRow, AbsenceTrigger } from '@/features/hr/utils/absence-queries';
import { hrErrorMessage } from '@/features/hr/utils/errors';
import { formatHalfDays } from '@/lib/hr/leave-calculation';

type SubjectOption = { id: string; name: string; isSelf: boolean };

export function RecordAbsenceDialog({
  subjects,
  canRecordForOthers
}: {
  subjects: SubjectOption[];
  canRecordForOthers: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const self = subjects.find((s) => s.isSelf);

  const [employeeId, setEmployeeId] = React.useState(self?.id ?? subjects[0]?.id ?? '');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [notes, setNotes] = React.useState('');

  function submit() {
    startTransition(async () => {
      try {
        await recordSickness({
          employeeId: canRecordForOthers ? employeeId : undefined,
          startDate,
          endDate: endDate || undefined,
          category: category.trim() || undefined,
          notes: notes.trim() || undefined,
          isSelfCertified: true
        });
        toast.success(endDate ? 'Absence recorded' : 'Absence recorded and left open');
        setOpen(false);
        setStartDate('');
        setEndDate('');
        setCategory('');
        setNotes('');
      } catch (error) {
        toast.error(hrErrorMessage(error));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Icons.add aria-hidden />
        Record absence
      </DialogTrigger>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Record absence</DialogTitle>
          <DialogDescription>
            Leave the return date blank if the absence is still ongoing.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          {canRecordForOthers && subjects.length > 1 && (
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='absence-subject'>Who</Label>
              <NativeSelect
                className='w-full'
                id='absence-subject'
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

          <div className='grid grid-cols-2 gap-3'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='absence-start'>First day absent</Label>
              <Input
                id='absence-start'
                type='date'
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='absence-end'>Returned on (optional)</Label>
              <Input
                id='absence-end'
                type='date'
                min={startDate || undefined}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='absence-category'>Category (optional)</Label>
            <Input
              id='absence-category'
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder='For example: musculoskeletal, mental health'
            />
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='absence-notes'>Notes (optional)</Label>
            <Textarea
              id='absence-notes'
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              The category and notes are health information. They are visible to the person
              themselves and to HR — never to a line manager, who sees only the dates.
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={!startDate || pending}>
            {pending ? 'Saving…' : 'Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseAbsenceButton({ record }: { record: AbsenceRow }) {
  const [open, setOpen] = React.useState(false);
  const [endDate, setEndDate] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant='ghost' size='sm' />}>Set return date</DialogTrigger>
      <DialogContent className='sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>Return to work</DialogTitle>
          <DialogDescription>
            Absence starting {record.startDate} for {record.employeeName}.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor={`return-${record.id}`}>First day back</Label>
          <Input
            id={`return-${record.id}`}
            type='date'
            min={record.startDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!endDate || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await closeSickness({ sicknessRecordId: record.id, endDate });
                  toast.success('Absence closed');
                  setOpen(false);
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnToWorkButton({ record }: { record: AbsenceRow }) {
  const [open, setOpen] = React.useState(false);
  const [conductedOn, setConductedOn] = React.useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState('');
  const [adjustments, setAdjustments] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant='ghost' size='sm' />}>
        {record.hasReturnToWork ? 'Edit interview' : 'Log interview'}
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Return-to-work interview</DialogTitle>
          <DialogDescription>
            For {record.employeeName}, absence from {record.startDate}.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor={`rtw-date-${record.id}`}>Held on</Label>
            <Input
              id={`rtw-date-${record.id}`}
              type='date'
              value={conductedOn}
              onChange={(e) => setConductedOn(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor={`rtw-notes-${record.id}`}>Notes</Label>
            <Textarea
              id={`rtw-notes-${record.id}`}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor={`rtw-adj-${record.id}`}>Adjustments agreed</Label>
            <Textarea
              id={`rtw-adj-${record.id}`}
              rows={2}
              value={adjustments}
              onChange={(e) => setAdjustments(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!conductedOn || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await recordReturnToWork({
                    sicknessRecordId: record.id,
                    conductedOn,
                    notes: notes.trim() || undefined,
                    adjustmentsAgreed: adjustments.trim() || undefined
                  });
                  toast.success('Interview recorded');
                  setOpen(false);
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AbsenceList({ records, canManage }: { records: AbsenceRow[]; canManage: boolean }) {
  if (records.length === 0) {
    return (
      <ListGroup label='Absence'>
        <ListRow
          label='No absence recorded'
          description='Sickness and unplanned absence recorded here builds the history that trigger thresholds are measured against.'
          leading={<Icons.absence aria-hidden />}
        />
      </ListGroup>
    );
  }

  const open = records.filter((r) => !r.endDate);
  const closed = records.filter((r) => r.endDate);

  return (
    <>
      {open.length > 0 && (
        <ListGroup label='Currently absent' note='These have no return date yet.'>
          {open.map((record) => (
            <ListRow
              key={record.id}
              label={record.employeeName}
              description={`Since ${record.startDate}${
                record.medical?.category ? ` · ${record.medical.category}` : ''
              }`}
              leading={<Icons.absence aria-hidden />}
              action={canManage ? <CloseAbsenceButton record={record} /> : undefined}
            />
          ))}
        </ListGroup>
      )}

      <ListGroup label='Absence history'>
        {closed.map((record) => (
          <ListRow
            key={record.id}
            label={record.employeeName}
            description={[
              `${record.startDate} to ${record.endDate}`,
              record.totalHalfDays !== null ? formatHalfDays(record.totalHalfDays) : null,
              record.medical?.category
            ]
              .filter(Boolean)
              .join(' · ')}
            leading={<Icons.absence aria-hidden />}
            value={
              record.hasReturnToWork ? <Badge variant='secondary'>interview done</Badge> : undefined
            }
            action={canManage ? <ReturnToWorkButton record={record} /> : undefined}
          />
        ))}
      </ListGroup>
    </>
  );
}

/**
 * Absence patterns that crossed a threshold. Presented as something to look at, never as a
 * verdict — the copy says so explicitly, because a Bradford score shown without that framing
 * gets treated as one.
 */
export function AbsenceTriggerList({ triggers }: { triggers: AbsenceTrigger[] }) {
  if (triggers.length === 0) return null;

  return (
    <ListGroup
      label='Worth a conversation'
      note='Bradford Factor weights several short absences more heavily than one long one. It is a prompt to check in with someone, not a disciplinary step, and nothing here happens automatically.'
    >
      {triggers.map((trigger) => (
        <ListRow
          key={trigger.employeeId}
          label={trigger.employeeName}
          description={`${trigger.occurrences} separate absences · ${trigger.totalDays} days total`}
          leading={<Icons.warning aria-hidden />}
          value={<Badge variant='outline'>score {trigger.bradfordScore}</Badge>}
        />
      ))}
    </ListGroup>
  );
}
