'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListGroup, ListRow } from '@/components/ui/list-group';
import { cancelLeaveRequest, decideLeaveRequest } from '@/features/hr/leave-actions';
import { hrErrorMessage } from '@/features/hr/utils/errors';
import type { LeaveRequestRow } from '@/features/hr/utils/leave-queries';
import { formatHalfDays } from '@/lib/hr/leave-calculation';

const STATUS_TONE: Record<LeaveRequestRow['status'], 'default' | 'secondary' | 'outline'> = {
  pending: 'outline',
  approved: 'default',
  declined: 'secondary',
  cancelled: 'secondary'
};

function unitLabel(unit: LeaveRequestRow['startUnit']): string {
  if (unit === 'am') return ' (morning)';
  if (unit === 'pm') return ' (afternoon)';
  return '';
}

function dateRangeLabel(row: LeaveRequestRow): string {
  if (row.startDate === row.endDate) return `${row.startDate}${unitLabel(row.startUnit)}`;
  return `${row.startDate}${unitLabel(row.startUnit)} → ${row.endDate}${unitLabel(row.endUnit)}`;
}

/**
 * One employee's own requests. Cancelling is offered for anything not already decided
 * against them; a declined request is history and has no action.
 */
export function LeaveRequestList({ requests }: { requests: LeaveRequestRow[] }) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  function cancel(id: string) {
    setPendingId(id);
    cancelLeaveRequest({ requestId: id })
      .then(() => toast.success('Booking cancelled'))
      .catch((error: unknown) => toast.error(hrErrorMessage(error)))
      .finally(() => setPendingId(null));
  }

  if (requests.length === 0) {
    return (
      <ListGroup label='Your requests'>
        <ListRow
          label='Nothing booked this leave year'
          description='Time off you book will appear here, with its approval status.'
          leading={<Icons.timeOff aria-hidden />}
        />
      </ListGroup>
    );
  }

  return (
    <ListGroup label='Your requests'>
      {requests.map((row) => (
        <ListRow
          key={row.id}
          label={`${row.leaveTypeName} — ${formatHalfDays(row.totalHalfDays)}`}
          description={dateRangeLabel(row)}
          value={
            <span className='flex items-center gap-2'>
              <Badge variant={STATUS_TONE[row.status]}>{row.status}</Badge>
              {row.autoApproved && row.status === 'approved' && (
                <span className='text-muted-foreground text-xs'>auto</span>
              )}
            </span>
          }
          action={
            row.status === 'pending' || row.status === 'approved' ? (
              <Button
                variant='ghost'
                size='sm'
                disabled={pendingId === row.id}
                onClick={() => cancel(row.id)}
              >
                Cancel
              </Button>
            ) : undefined
          }
        />
      ))}
    </ListGroup>
  );
}

/**
 * The approval queue. Only requests the server already decided this caller may act on reach
 * here — `listPendingApprovals` filters them — and `decideLeaveRequest` re-checks on every
 * click, so a stale page cannot approve something the caller has since lost rights to.
 */
export function LeaveApprovalQueue({ requests }: { requests: LeaveRequestRow[] }) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  function decide(id: string, decision: 'approved' | 'declined') {
    setPendingId(id);
    decideLeaveRequest({ requestId: id, decision })
      .then(() => toast.success(decision === 'approved' ? 'Approved' : 'Declined'))
      .catch((error: unknown) => toast.error(hrErrorMessage(error)))
      .finally(() => setPendingId(null));
  }

  if (requests.length === 0) return null;

  return (
    <ListGroup
      label={`Awaiting your decision (${requests.length})`}
      note='Approving writes the dates into the shared calendar so the team can see who is away.'
    >
      {requests.map((row) => (
        <ListRow
          key={row.id}
          label={`${row.employeeName} — ${formatHalfDays(row.totalHalfDays)} ${row.leaveTypeName}`}
          description={`${dateRangeLabel(row)}${row.reason ? ` · ${row.reason}` : ''}`}
          leading={<Icons.timeOff aria-hidden />}
          action={
            <span className='flex items-center gap-1.5'>
              <Button
                variant='ghost'
                size='sm'
                disabled={pendingId === row.id}
                onClick={() => decide(row.id, 'declined')}
              >
                Decline
              </Button>
              <Button
                size='sm'
                disabled={pendingId === row.id}
                onClick={() => decide(row.id, 'approved')}
              >
                Approve
              </Button>
            </span>
          }
        />
      ))}
    </ListGroup>
  );
}

/** Who else is off in the same window — shown as information, never as a block. */
export function LeaveClashList({ requests }: { requests: LeaveRequestRow[] }) {
  if (requests.length === 0) return null;

  return (
    <ListGroup
      label='Also away soon'
      note='Overlapping leave is allowed. This is here so clashes are noticed before they become a problem, not to stop a booking.'
    >
      {requests.slice(0, 8).map((row) => (
        <ListRow
          key={row.id}
          label={row.employeeName}
          description={dateRangeLabel(row)}
          leading={<Icons.user aria-hidden />}
          value={
            <Badge variant={row.status === 'pending' ? 'outline' : 'secondary'}>
              {row.status === 'pending' ? 'requested' : row.leaveTypeName}
            </Badge>
          }
        />
      ))}
    </ListGroup>
  );
}
