'use client';

import * as React from 'react';
import { toast } from 'sonner';
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
import { Textarea } from '@/components/ui/textarea';
import { clearLeaveAllowance, upsertLeaveAllowance } from '@/features/hr/settings-actions';
import { hrErrorMessage } from '@/features/hr/utils/errors';
import type { AllowanceRow } from '@/features/hr/utils/settings-queries';

function formatDays(days: number): string {
  const rounded = Math.round(days * 2) / 2;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} day${
    Math.abs(rounded) === 1 ? '' : 's'
  }`;
}

function AllowanceDialog({
  row,
  leaveYearStart,
  leaveYearLabel
}: {
  row: AllowanceRow;
  leaveYearStart: string;
  leaveYearLabel: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [entitlementDays, setEntitlementDays] = React.useState(row.entitlementDays);
  const [carriedOverDays, setCarriedOverDays] = React.useState(row.carriedOverDays);
  const [adjustmentDays, setAdjustmentDays] = React.useState(row.adjustmentDays);
  const [adjustmentNote, setAdjustmentNote] = React.useState(row.adjustmentNote ?? '');

  const total = entitlementDays + carriedOverDays + adjustmentDays;

  function save() {
    startTransition(async () => {
      try {
        await upsertLeaveAllowance({
          employeeId: row.employeeId,
          leaveYearStart,
          entitlementDays,
          carriedOverDays,
          adjustmentDays,
          adjustmentNote: adjustmentNote.trim() || undefined
        });
        toast.success(`${row.name}: ${formatDays(total)} for ${leaveYearLabel}`);
        setOpen(false);
      } catch (error) {
        toast.error(hrErrorMessage(error));
      }
    });
  }

  function reset() {
    startTransition(async () => {
      try {
        await clearLeaveAllowance(row.employeeId, leaveYearStart);
        toast.success(`${row.name} is back on the company default`);
        setOpen(false);
      } catch (error) {
        toast.error(hrErrorMessage(error));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant='ghost' size='sm' />}>
        {row.isExplicit ? 'Edit' : 'Set'}
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{row.name}</DialogTitle>
          <DialogDescription>
            Time off for the leave year starting {leaveYearLabel}. Everything is in days; half
            days are allowed.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='entitlement-days'>Days off per year</Label>
            <Input
              id='entitlement-days'
              type='number'
              min={0}
              max={366}
              step={0.5}
              value={entitlementDays}
              disabled={pending}
              onChange={(e) => setEntitlementDays(Number(e.target.value))}
            />
            <p className='text-muted-foreground text-xs'>
              This person&apos;s own entitlement. It overrides the company default for this leave
              year only.
            </p>
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='carried-days'>Carried over</Label>
              <Input
                id='carried-days'
                type='number'
                min={0}
                max={366}
                step={0.5}
                value={carriedOverDays}
                disabled={pending}
                onChange={(e) => setCarriedOverDays(Number(e.target.value))}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='adjustment-days'>Adjustment</Label>
              <Input
                id='adjustment-days'
                type='number'
                min={-366}
                max={366}
                step={0.5}
                value={adjustmentDays}
                disabled={pending}
                onChange={(e) => setAdjustmentDays(Number(e.target.value))}
              />
            </div>
          </div>
          <p className='text-muted-foreground -mt-2 text-xs'>
            An adjustment can be negative. It is kept separate from the entitlement so a
            correction or a day awarded in lieu stays visible rather than being folded into a
            number nobody can explain later.
          </p>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='adjustment-note'>Why (optional)</Label>
            <Textarea
              id='adjustment-note'
              rows={2}
              maxLength={1000}
              value={adjustmentNote}
              disabled={pending}
              placeholder='e.g. day in lieu for the weekend audit'
              onChange={(e) => setAdjustmentNote(e.target.value)}
            />
          </div>

          <div className='bg-muted/60 rounded-xl px-3 py-2.5 text-sm'>
            <p className='font-medium'>{formatDays(total)} available this leave year</p>
            <p className='text-muted-foreground text-xs'>
              Before anything already booked is taken off.
            </p>
          </div>
        </div>

        <DialogFooter className='sm:justify-between'>
          {row.isExplicit ? (
            <Button variant='ghost' onClick={reset} disabled={pending}>
              Use company default
            </Button>
          ) : (
            <span />
          )}
          <div className='flex gap-2'>
            <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
            <Button onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AllowancesPanel({
  rows,
  leaveYearStart,
  leaveYearLabel,
  defaultEntitlementDays
}: {
  rows: AllowanceRow[];
  leaveYearStart: string;
  leaveYearLabel: string;
  defaultEntitlementDays: number;
}) {
  const [query, setQuery] = React.useState('');

  const filtered = query.trim()
    ? rows.filter((row) => row.name.toLowerCase().includes(query.trim().toLowerCase()))
    : rows;

  return (
    <div className='flex flex-col gap-3'>
      <div className='px-1'>
        <h2 className='text-sm font-medium'>Individual allowances</h2>
        <p className='text-muted-foreground text-xs'>
          Everyone starts on the company default of {formatDays(defaultEntitlementDays)}. Set a
          figure here for anyone on different terms — a part-time week, a negotiated extra week, a
          mid-year starter.
        </p>
      </div>

      {rows.length > 8 && (
        <Input
          aria-label='Filter people'
          placeholder='Filter by name'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className='max-w-xs'
        />
      )}

      {filtered.length === 0 ? (
        <ListGroup>
          <div className='p-4'>
            <p className='text-muted-foreground text-sm'>
              {rows.length === 0
                ? 'No active employees yet. People appear here once an administrator approves their sign-in.'
                : 'Nobody matches that.'}
            </p>
          </div>
        </ListGroup>
      ) : (
        <ListGroup note='"Default" means nobody has set this person a figure, so the company default applies. That is not the same as setting it to zero.'>
          {filtered.map((row) => (
            <ListRow
              key={row.employeeId}
              label={row.name}
              description={
                [row.jobTitle, row.team].filter(Boolean).join(' · ') || 'No job title recorded'
              }
              value={
                <span className='flex items-center gap-2'>
                  {!row.isExplicit && <Badge variant='secondary'>Default</Badge>}
                  {formatDays(row.entitlementDays + row.carriedOverDays + row.adjustmentDays)}
                </span>
              }
              action={
                <AllowanceDialog
                  row={row}
                  leaveYearStart={leaveYearStart}
                  leaveYearLabel={leaveYearLabel}
                />
              }
            />
          ))}
        </ListGroup>
      )}
    </div>
  );
}
