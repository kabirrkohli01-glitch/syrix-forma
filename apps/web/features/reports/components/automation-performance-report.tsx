import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import type { AutomationPerformance } from '../utils/queries';

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

export function AutomationPerformanceTable({ rows }: { rows: AutomationPerformance[] }) {
  if (rows.length === 0)
    return <p className='text-muted-foreground text-sm'>No automations defined.</p>;

  return (
    <div className='overflow-hidden rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Automation</TableHead>
            <TableHead className='text-right'>Runs</TableHead>
            <TableHead className='text-right'>Success rate</TableHead>
            <TableHead className='text-right'>Failed</TableHead>
            <TableHead className='text-right'>Avg duration</TableHead>
            <TableHead>Last run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className='font-medium'>{row.name}</TableCell>
              <TableCell className='text-right'>{row.totalRuns}</TableCell>
              <TableCell className='text-right'>
                {row.successRatePct === null ? '—' : `${row.successRatePct}%`}
              </TableCell>
              <TableCell className='text-right'>
                {row.failedCount > 0 ? <Badge variant='destructive'>{row.failedCount}</Badge> : 0}
              </TableCell>
              <TableCell className='text-right'>{formatDuration(row.avgDurationSeconds)}</TableCell>
              <TableCell className='text-muted-foreground'>
                {row.lastRunAt
                  ? `${row.lastRunAt.toLocaleString()} (${row.lastRunStatus})`
                  : 'never'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
