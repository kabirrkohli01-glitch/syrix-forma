'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListGroup } from '@/components/ui/list-group';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { updateLeaveSettings } from '@/features/hr/settings-actions';
import { hrErrorMessage } from '@/features/hr/utils/errors';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

export type LeavePolicyValues = {
  leaveYearStartMonth: number;
  leaveYearStartDay: number;
  defaultEntitlementDays: number;
  carryOverMaxDays: number;
  carryOverExpiryMonths: number;
  allowNegativeBalance: boolean;
};

/**
 * Company leave policy.
 *
 * Everything is entered in days. The database counts half days, and that conversion happens once,
 * server-side, in settings-actions.ts — a form that asked for half days would be asking HR to do
 * the app's arithmetic and would eventually be filled in wrong.
 *
 * A Save button rather than save-on-change, unlike the smaller preference forms elsewhere: these
 * six fields are one policy and are meant to be reviewed together, and a half-typed entitlement
 * saved on blur would briefly be every employee's real entitlement.
 */
export function LeavePolicyForm({ initial }: { initial: LeavePolicyValues }) {
  const [values, setValues] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();

  const dirty = (Object.keys(initial) as (keyof LeavePolicyValues)[]).some(
    (key) => values[key] !== initial[key]
  );

  function set<K extends keyof LeavePolicyValues>(key: K, value: LeavePolicyValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      try {
        await updateLeaveSettings(values);
        toast.success('Leave policy saved');
      } catch (error) {
        toast.error(hrErrorMessage(error));
      }
    });
  }

  return (
    <ListGroup
      label='Leave policy'
      note='Applies to the whole company. Anyone given their own allowance below is unaffected by the default.'
    >
      <div className='flex flex-col gap-5 p-4'>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='default-entitlement'>Days off per year</Label>
            <Input
              id='default-entitlement'
              type='number'
              min={0}
              max={366}
              step={0.5}
              value={values.defaultEntitlementDays}
              disabled={pending}
              onChange={(e) => set('defaultEntitlementDays', Number(e.target.value))}
            />
            <p className='text-muted-foreground text-xs'>
              What everyone gets unless they have their own figure. 28 is the UK statutory minimum
              for a five-day week including bank holidays. Half days are allowed.
            </p>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label>Leave year starts</Label>
            <div className='flex gap-2'>
              <Input
                aria-label='Day the leave year starts'
                type='number'
                min={1}
                max={31}
                className='w-20'
                value={values.leaveYearStartDay}
                disabled={pending}
                onChange={(e) => set('leaveYearStartDay', Number(e.target.value))}
              />
              <NativeSelect
                aria-label='Month the leave year starts'
                className='flex-1'
                value={values.leaveYearStartMonth}
                disabled={pending}
                onChange={(e) => set('leaveYearStartMonth', Number(e.target.value))}
              >
                {MONTHS.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <p className='text-muted-foreground text-xs'>
              Balances are counted from this date. 1 January and 1 April are the usual choices;
              changing it later re-counts everyone&apos;s balance against the new window.
            </p>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='carry-over-max'>Days that can be carried over</Label>
            <Input
              id='carry-over-max'
              type='number'
              min={0}
              max={366}
              step={0.5}
              value={values.carryOverMaxDays}
              disabled={pending}
              onChange={(e) => set('carryOverMaxDays', Number(e.target.value))}
            />
            <p className='text-muted-foreground text-xs'>
              The most anyone may bring into the next leave year. Set it to 0 to switch carry-over
              off entirely.
            </p>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='carry-over-expiry'>Carried days expire after</Label>
            <Input
              id='carry-over-expiry'
              type='number'
              min={0}
              max={24}
              step={1}
              value={values.carryOverExpiryMonths}
              disabled={pending}
              onChange={(e) => set('carryOverExpiryMonths', Number(e.target.value))}
            />
            <p className='text-muted-foreground text-xs'>
              Months into the new leave year. 0 means they never expire.
            </p>
          </div>
        </div>

        <div className='flex items-start gap-2.5 border-t pt-4'>
          <Switch
            id='allow-negative'
            checked={values.allowNegativeBalance}
            disabled={pending}
            onCheckedChange={(next) => set('allowNegativeBalance', next)}
          />
          <div>
            <Label htmlFor='allow-negative' className='text-sm font-normal'>
              Allow booking beyond the allowance
            </Label>
            <p className='text-muted-foreground text-xs'>
              Off means a request that would take someone past their remaining days is refused
              when they submit it. On means it is allowed and the balance goes negative, which an
              approver still sees before deciding.
            </p>
          </div>
        </div>

        <div className='flex items-center gap-3'>
          <Button onClick={save} disabled={!dirty || pending}>
            {pending ? 'Saving…' : 'Save leave policy'}
          </Button>
          {dirty && !pending && (
            <span className='text-muted-foreground text-xs'>Unsaved changes</span>
          )}
        </div>
      </div>
    </ListGroup>
  );
}
