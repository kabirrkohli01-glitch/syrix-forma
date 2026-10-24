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
import {
  addExpenseItem,
  createExpenseClaim,
  decideExpenseClaim,
  markExpenseClaimPaid,
  submitExpenseClaim
} from '@/features/hr/work-actions';
import { hrErrorMessage } from '@/features/hr/utils/errors';
import type { ExpenseClaimRow } from '@/features/hr/utils/work-queries';
import { formatPence } from '@/lib/hr/money';

type Category = { id: string; name: string; isMileage: boolean; warnOverPence: number | null };

export function NewClaimButton() {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Icons.add aria-hidden />
        New claim
      </DialogTrigger>
      <DialogContent className='sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>New expense claim</DialogTitle>
          <DialogDescription>Add items to it, then submit the whole claim.</DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='claim-title'>What is it for</Label>
          <Input
            id='claim-title'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='September travel'
          />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!title.trim() || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await createExpenseClaim({ title: title.trim() });
                  toast.success('Claim created');
                  setOpen(false);
                  setTitle('');
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddItemDialog({ claimId, categories }: { claimId: string; categories: Category[] }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [categoryId, setCategoryId] = React.useState(categories[0]?.id ?? '');
  const [description, setDescription] = React.useState('');
  const [spentOn, setSpentOn] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [miles, setMiles] = React.useState('');

  const category = categories.find((c) => c.id === categoryId);
  const isMileage = category?.isMileage ?? false;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant='ghost' size='sm' />}>Add item</DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Add an item</DialogTitle>
          <DialogDescription>
            {isMileage
              ? 'Mileage is worked out from the HMRC rate that applied on the date of the journey, and from how far you have already claimed this tax year.'
              : 'Enter the amount you actually spent.'}
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='item-category'>Category</Label>
            <NativeSelect
              className='w-full'
              id='item-category'
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='item-description'>Description</Label>
            <Input
              id='item-description'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='item-date'>Date</Label>
            <Input
              id='item-date'
              type='date'
              value={spentOn}
              onChange={(e) => setSpentOn(e.target.value)}
            />
          </div>
          {isMileage ? (
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='item-miles'>Miles</Label>
              <Input
                id='item-miles'
                type='number'
                min='1'
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
              />
            </div>
          ) : (
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='item-amount'>Amount</Label>
              <Input
                id='item-amount'
                inputMode='decimal'
                placeholder='12.50'
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {category?.warnOverPence && (
                <p className='text-muted-foreground text-xs'>
                  Usually under {formatPence(category.warnOverPence)} for this category.
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!description.trim() || !spentOn || (isMileage ? !miles : !amount) || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  const result = await addExpenseItem({
                    claimId,
                    categoryId,
                    description: description.trim(),
                    spentOn,
                    amount: isMileage ? undefined : amount,
                    miles: isMileage ? Number(miles) : undefined
                  });
                  toast.success(`Added ${formatPence(result.amountPence)}`);
                  setOpen(false);
                  setDescription('');
                  setAmount('');
                  setMiles('');
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExpenseClaimList({
  claims,
  categories,
  callerId,
  canPay
}: {
  claims: ExpenseClaimRow[];
  categories: Category[];
  callerId: string;
  canPay: boolean;
}) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  function run(id: string, promise: Promise<unknown>, message: string) {
    setPendingId(id);
    promise
      .then(() => toast.success(message))
      .catch((error: unknown) => toast.error(hrErrorMessage(error)))
      .finally(() => setPendingId(null));
  }

  if (claims.length === 0) {
    return (
      <ListGroup label='Claims'>
        <ListRow
          label='No claims yet'
          description='Create a claim, add what you spent, then submit it for approval.'
          leading={<Icons.expenses aria-hidden />}
        />
      </ListGroup>
    );
  }

  return (
    <ListGroup
      label='Claims'
      note='Approving a claim and marking it paid are separate steps, held by different people.'
    >
      {claims.map((claim) => {
        const isMine = claim.employeeId === callerId;
        return (
          <ListRow
            key={claim.id}
            label={`${claim.title}${isMine ? '' : ` · ${claim.employeeName}`}`}
            description={formatPence(claim.totalPence, claim.currency)}
            leading={<Icons.expenses aria-hidden />}
            value={<Badge variant='outline'>{claim.status}</Badge>}
            action={
              <span className='flex items-center gap-1'>
                {isMine && claim.status === 'draft' && (
                  <>
                    <AddItemDialog claimId={claim.id} categories={categories} />
                    <Button
                      size='sm'
                      disabled={pendingId === claim.id || claim.totalPence <= 0}
                      onClick={() =>
                        run(claim.id, submitExpenseClaim({ claimId: claim.id }), 'Submitted')
                      }
                    >
                      Submit
                    </Button>
                  </>
                )}
                {!isMine && claim.status === 'submitted' && (
                  <>
                    <Button
                      variant='ghost'
                      size='sm'
                      disabled={pendingId === claim.id}
                      onClick={() =>
                        run(
                          claim.id,
                          decideExpenseClaim({ claimId: claim.id, decision: 'rejected' }),
                          'Rejected'
                        )
                      }
                    >
                      Reject
                    </Button>
                    <Button
                      size='sm'
                      disabled={pendingId === claim.id}
                      onClick={() =>
                        run(
                          claim.id,
                          decideExpenseClaim({ claimId: claim.id, decision: 'approved' }),
                          'Approved'
                        )
                      }
                    >
                      Approve
                    </Button>
                  </>
                )}
                {canPay && claim.status === 'approved' && (
                  <Button
                    size='sm'
                    disabled={pendingId === claim.id}
                    onClick={() =>
                      run(claim.id, markExpenseClaimPaid({ claimId: claim.id }), 'Marked as paid')
                    }
                  >
                    Mark paid
                  </Button>
                )}
              </span>
            }
          />
        );
      })}
    </ListGroup>
  );
}
