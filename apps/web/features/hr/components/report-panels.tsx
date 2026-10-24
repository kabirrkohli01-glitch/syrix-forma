'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListGroup, ListRow } from '@/components/ui/list-group';
import { exportPayrollCsv } from '@/features/hr/payroll-actions';
import { hrErrorMessage } from '@/features/hr/utils/errors';
import type {
  BurnoutSignal,
  DemographicRow,
  LeaveReportRow
} from '@/features/hr/utils/report-queries';
import { formatMinutes } from '@/lib/hr/money';

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card size='sm'>
      <CardContent className='flex flex-col gap-0.5'>
        <span className='text-2xl font-semibold tabular-nums'>{value}</span>
        <span className='text-muted-foreground text-xs'>{label}</span>
        {hint && <span className='text-muted-foreground text-xs opacity-80'>{hint}</span>}
      </CardContent>
    </Card>
  );
}

export function DemographicList({ rows }: { rows: DemographicRow[] }) {
  return (
    <ListGroup
      label='Contract types'
      note='Groups of fewer than five are combined rather than listed. A category containing one person is that person’s record, not a statistic.'
    >
      {rows.length === 0 ? (
        <ListRow
          label='Nothing recorded'
          description='Contract types appear here once employment records are filled in.'
          leading={<Icons.chartBar aria-hidden />}
        />
      ) : (
        rows.map((row) => (
          <ListRow
            key={row.label}
            label={row.label}
            leading={<Icons.chartBar aria-hidden />}
            value={
              <span className='flex items-center gap-2'>
                {row.suppressed && <Badge variant='outline'>combined</Badge>}
                <span className='tabular-nums'>{row.count}</span>
              </span>
            }
          />
        ))
      )}
    </ListGroup>
  );
}

export function LeaveUsageList({ rows }: { rows: LeaveReportRow[] }) {
  return (
    <ListGroup label='Leave taken'>
      {rows.length === 0 ? (
        <ListRow
          label='No data yet'
          description='Leave taken against entitlement appears here once people start booking.'
          leading={<Icons.timeOff aria-hidden />}
        />
      ) : (
        rows
          .slice(0, 20)
          .map((row) => (
            <ListRow
              key={row.employeeId}
              label={row.employeeName}
              description={`${row.takenDays} of ${row.entitlementDays} days taken`}
              leading={<Icons.timeOff aria-hidden />}
              value={<span className='tabular-nums'>{row.remainingDays} left</span>}
            />
          ))
      )}
    </ListGroup>
  );
}

export function BurnoutList({ signals }: { signals: BurnoutSignal[] }) {
  return (
    <ListGroup
      label='Worth checking in on'
      note='Flagged only when more than one pattern appears together — holiday untaken, repeated short absences, consistently long weeks. Any one alone has too many innocent explanations. Nothing here happens automatically.'
    >
      {signals.length === 0 ? (
        <ListRow
          label='Nothing standing out'
          description='Nobody currently shows more than one of the patterns this looks for.'
          leading={<Icons.check aria-hidden />}
        />
      ) : (
        signals.map((signal) => (
          <ListRow
            key={signal.employeeId}
            label={signal.employeeName}
            description={signal.reasons.join(' · ')}
            leading={<Icons.warning aria-hidden />}
            value={
              signal.overtimeMinutes > 0 ? (
                <span className='text-muted-foreground text-xs'>
                  +{formatMinutes(signal.overtimeMinutes)}
                </span>
              ) : undefined
            }
          />
        ))
      )}
    </ListGroup>
  );
}

/**
 * Payroll export.
 *
 * The file is built server-side and handed back as a string, then turned into a download in
 * the browser. It is deliberately not a GET route: a URL that returns everyone's pay changes
 * is one that can be pasted, logged by a proxy, or left in browser history.
 */
export function PayrollExportCard({
  defaultFrom,
  defaultTo
}: {
  defaultFrom: string;
  defaultTo: string;
}) {
  const [from, setFrom] = React.useState(defaultFrom);
  const [to, setTo] = React.useState(defaultTo);
  const [pending, startTransition] = React.useTransition();
  function download() {
    startTransition(async () => {
      try {
        const result = await exportPayrollCsv({ from, to });

        const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.filename;
        link.click();
        URL.revokeObjectURL(url);

        toast.success(`Exported ${result.rowCount} change${result.rowCount === 1 ? '' : 's'}`);
      } catch (error) {
        // Cancelling the re-auth dialog rejects with 'Cancelled'; that is the user changing
        // their mind, not a failure worth shouting about.
        if (error instanceof Error && error.message === 'Cancelled') return;
        toast.error(hrErrorMessage(error));
      }
    });
  }

  return (
    <Card>
      <CardContent className='flex flex-col gap-4'>
        <div>
          <p className='text-base font-medium'>Payroll changes</p>
          <p className='text-muted-foreground text-sm'>
            Starters, leavers, unpaid leave, approved expenses and approved hours for a period, as
            CSV. Standing salaries are not included — payroll already holds those, and this file is
            safer without them. Requires a fresh authenticator code and is recorded in the audit
            log.
          </p>
        </div>
        <div className='flex flex-wrap items-end gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='payroll-from'>From</Label>
            <Input
              id='payroll-from'
              type='date'
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='payroll-to'>To</Label>
            <Input id='payroll-to' type='date' value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button disabled={!from || !to || from > to || pending} onClick={download}>
            <Icons.upload aria-hidden />
            {pending ? 'Preparing…' : 'Export CSV'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
