import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import type { ClientActivityReport, ResponseTimeStats } from '../utils/queries';

export function ClientActivityView({ report }: { report: ClientActivityReport }) {
  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap gap-2'>
        <Badge variant='outline' className='text-xs'>
          active clients: {report.totalActive}
        </Badge>
        <Badge variant={report.staleCount > 0 ? 'destructive' : 'secondary'} className='text-xs'>
          no activity in {report.staleThresholdDays}d: {report.staleCount}
        </Badge>
      </div>
      {report.mostActive.length === 0 ? (
        <p className='text-muted-foreground text-sm'>No recorded activity yet.</p>
      ) : (
        <div className='overflow-hidden rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className='text-right'>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.mostActive.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className='font-medium'>{row.name}</TableCell>
                  <TableCell className='text-muted-foreground capitalize'>{row.team}</TableCell>
                  <TableCell className='text-muted-foreground text-right'>
                    {format(row.lastActivityAt, 'MMM d, yyyy')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function ResponseTimeView({ stats }: { stats: ResponseTimeStats }) {
  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 gap-4 text-center sm:grid-cols-4'>
        <div>
          <p className='text-2xl font-semibold'>{stats.respondedCount}</p>
          <p className='text-muted-foreground text-xs'>Responded (by email)</p>
        </div>
        <div>
          <p className='text-2xl font-semibold'>{stats.pendingCount}</p>
          <p className='text-muted-foreground text-xs'>No email reply yet</p>
        </div>
        <div>
          <p className='text-2xl font-semibold'>{formatHours(stats.avgResponseHours)}</p>
          <p className='text-muted-foreground text-xs'>Avg response time</p>
        </div>
        <div>
          <p className='text-2xl font-semibold'>{formatHours(stats.medianResponseHours)}</p>
          <p className='text-muted-foreground text-xs'>Median response time</p>
        </div>
      </div>
      <p className='text-muted-foreground text-sm'>
        SLA target: first reply within {stats.slaHours}h.{' '}
        {stats.withinSlaPct === null ? (
          'No emailed responses yet to measure.'
        ) : (
          <>
            <span className='text-foreground font-medium'>{stats.withinSlaPct}%</span> of responded
            enquiries ({stats.withinSlaCount}/{stats.respondedCount}) met it.
          </>
        )}
      </p>
      <p className='text-muted-foreground text-xs'>
        Based on the first outbound email linked to an enquiry — a reply given by phone or in person
        isn&apos;t tracked here.
      </p>
    </div>
  );
}
