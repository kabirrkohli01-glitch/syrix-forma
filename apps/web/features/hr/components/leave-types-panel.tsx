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
import { Switch } from '@/components/ui/switch';
import { setLeaveTypeArchived, upsertLeaveType } from '@/features/hr/settings-actions';
import { hrErrorMessage } from '@/features/hr/utils/errors';

export type LeaveTypeRow = {
  id: string;
  name: string;
  deductsFromAllowance: boolean;
  isPaid: boolean;
  requiresApproval: boolean;
  colour: string | null;
  archivedAt: Date | null;
};

const DEFAULT_COLOUR = '#3b82f6';

function LeaveTypeDialog({ existing }: { existing?: LeaveTypeRow }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(existing?.name ?? '');
  const [deducts, setDeducts] = React.useState(existing?.deductsFromAllowance ?? true);
  const [isPaid, setIsPaid] = React.useState(existing?.isPaid ?? true);
  const [requiresApproval, setRequiresApproval] = React.useState(existing?.requiresApproval ?? true);
  const [colour, setColour] = React.useState(existing?.colour ?? DEFAULT_COLOUR);

  function save() {
    startTransition(async () => {
      try {
        await upsertLeaveType({
          id: existing?.id,
          name,
          deductsFromAllowance: deducts,
          isPaid,
          requiresApproval,
          colour
        });
        toast.success(existing ? `"${name}" updated` : `"${name}" added`);
        setOpen(false);
      } catch (error) {
        toast.error(hrErrorMessage(error));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={existing ? 'ghost' : 'default'} size='sm' />}>
        {existing ? (
          'Edit'
        ) : (
          <>
            <Icons.add aria-hidden />
            Add a leave type
          </>
        )}
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.name}` : 'Add a leave type'}</DialogTitle>
          <DialogDescription>
            A leave type is what someone picks when they book. Holiday, sick leave and unpaid
            leave behave differently, which is what the switches below decide.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='leave-type-name'>Name</Label>
            <Input
              id='leave-type-name'
              value={name}
              maxLength={100}
              placeholder='e.g. Holiday'
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className='flex items-start gap-2.5'>
            <Switch
              id='leave-type-deducts'
              checked={deducts}
              disabled={pending}
              onCheckedChange={setDeducts}
            />
            <div>
              <Label htmlFor='leave-type-deducts' className='text-sm font-normal'>
                Uses the annual allowance
              </Label>
              <p className='text-muted-foreground text-xs'>
                On for holiday. Off for unpaid leave, jury service or compassionate leave — still
                booked and still on the calendar, but it never reduces anyone&apos;s days.
              </p>
            </div>
          </div>

          <div className='flex items-start gap-2.5'>
            <Switch
              id='leave-type-approval'
              checked={requiresApproval}
              disabled={pending}
              onCheckedChange={setRequiresApproval}
            />
            <div>
              <Label htmlFor='leave-type-approval' className='text-sm font-normal'>
                Needs approving
              </Label>
              <p className='text-muted-foreground text-xs'>
                Off records it as approved the moment it is submitted — which is what you want for
                something self-certified, and not for holiday.
              </p>
            </div>
          </div>

          <div className='flex items-start gap-2.5'>
            <Switch
              id='leave-type-paid'
              checked={isPaid}
              disabled={pending}
              onCheckedChange={setIsPaid}
            />
            <div>
              <Label htmlFor='leave-type-paid' className='text-sm font-normal'>
                Paid
              </Label>
              <p className='text-muted-foreground text-xs'>
                Recorded for reporting and payroll export. It does not itself change anyone&apos;s
                pay.
              </p>
            </div>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='leave-type-colour'>Colour on the calendar</Label>
            <div className='flex items-center gap-2'>
              <Input
                id='leave-type-colour'
                type='color'
                className='h-9 w-16 p-1'
                value={colour}
                disabled={pending}
                onChange={(e) => setColour(e.target.value)}
              />
              <span className='text-muted-foreground text-xs'>{colour}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button onClick={save} disabled={pending || name.trim().length === 0}>
            {pending ? 'Saving…' : existing ? 'Save changes' : 'Add leave type'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveButton({ type }: { type: LeaveTypeRow }) {
  const [pending, startTransition] = React.useTransition();
  const archived = type.archivedAt !== null;

  function toggle() {
    startTransition(async () => {
      try {
        await setLeaveTypeArchived(type.id, !archived);
        toast.success(archived ? `"${type.name}" is bookable again` : `"${type.name}" archived`);
      } catch (error) {
        toast.error(hrErrorMessage(error));
      }
    });
  }

  return (
    <Button variant='ghost' size='sm' onClick={toggle} disabled={pending}>
      {archived ? 'Restore' : 'Archive'}
    </Button>
  );
}

export function LeaveTypesPanel({ types }: { types: LeaveTypeRow[] }) {
  const active = types.filter((t) => t.archivedAt === null);
  const archived = types.filter((t) => t.archivedAt !== null);

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2 px-1'>
        <div>
          <h2 className='text-sm font-medium'>Leave types</h2>
          <p className='text-muted-foreground text-xs'>
            What people can choose when they book. Nothing can be booked until at least one exists.
          </p>
        </div>
        <LeaveTypeDialog />
      </div>

      {active.length === 0 ? (
        <ListGroup>
          <div className='p-4'>
            <p className='text-sm font-medium'>No leave types yet</p>
            <p className='text-muted-foreground text-xs'>
              Time Off will tell everyone there is nothing to book until you add one. Start with
              Holiday — uses the allowance, needs approving — then add Sick leave and Unpaid leave
              with &quot;uses the annual allowance&quot; switched off.
            </p>
          </div>
        </ListGroup>
      ) : (
        <ListGroup>
          {active.map((type) => (
            <ListRow
              key={type.id}
              leading={
                <span
                  aria-hidden
                  className='size-3 rounded-full'
                  style={{ backgroundColor: type.colour ?? DEFAULT_COLOUR }}
                />
              }
              label={type.name}
              description={[
                type.deductsFromAllowance ? 'Uses allowance' : 'Does not use allowance',
                type.requiresApproval ? 'Needs approving' : 'Approved automatically',
                type.isPaid ? 'Paid' : 'Unpaid'
              ].join(' · ')}
              action={
                <span className='flex items-center gap-1'>
                  <LeaveTypeDialog existing={type} />
                  <ArchiveButton type={type} />
                </span>
              }
            />
          ))}
        </ListGroup>
      )}

      {archived.length > 0 && (
        <ListGroup
          label='Archived'
          note='Nobody can book these, and leave already taken against them stays on the record.'
        >
          {archived.map((type) => (
            <ListRow
              key={type.id}
              label={type.name}
              value={<Badge variant='secondary'>Archived</Badge>}
              action={<ArchiveButton type={type} />}
            />
          ))}
        </ListGroup>
      )}
    </div>
  );
}
