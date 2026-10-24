import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE, type Tone } from '@/lib/status-colors';
import type { ActiveProjectsSummary, OverdueWorkReport, ProjectHealthRow } from '../utils/queries';

export function ActiveProjectsSummaryView({ summary }: { summary: ActiveProjectsSummary }) {
  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-2'>
        {summary.byStatus.map((s) => {
          const tone: Tone =
            PROJECT_STATUS_TONE[s.status as keyof typeof PROJECT_STATUS_TONE] ?? 'muted';
          const label =
            PROJECT_STATUS_LABEL[s.status as keyof typeof PROJECT_STATUS_LABEL] ??
            s.status.replace('_', ' ');
          return (
            <StatusBadge key={s.status} tone={tone} className='text-xs'>
              {label}: {s.count}
            </StatusBadge>
          );
        })}
        <Badge variant='outline' className='text-xs'>
          total: {summary.total}
        </Badge>
      </div>
      {summary.byTeam.length === 0 ? (
        <p className='text-muted-foreground text-sm'>No active projects.</p>
      ) : (
        <div className='overflow-hidden rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead className='text-right'>Active projects</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.byTeam.map((row) => (
                <TableRow key={row.team}>
                  <TableCell className='font-medium capitalize'>{row.team}</TableCell>
                  <TableCell className='text-right'>{row.activeCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function OverdueWorkView({ report }: { report: OverdueWorkReport }) {
  return (
    <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
      <div>
        <p className='mb-2 text-sm font-medium'>
          Overdue tasks{' '}
          <Badge variant={report.overdueTaskCount > 0 ? 'destructive' : 'secondary'}>
            {report.overdueTaskCount}
          </Badge>
        </p>
        {report.overdueTasksByTeam.length === 0 ? (
          <p className='text-muted-foreground text-sm'>None.</p>
        ) : (
          <ul className='flex flex-col gap-1'>
            {report.overdueTasksByTeam.map((row) => (
              <li key={row.team} className='flex items-center justify-between text-sm'>
                <span className='capitalize'>{row.team}</span>
                <span className='text-muted-foreground'>{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className='mb-2 text-sm font-medium'>
          Overdue milestones{' '}
          <Badge variant={report.overdueMilestoneCount > 0 ? 'destructive' : 'secondary'}>
            {report.overdueMilestoneCount}
          </Badge>
        </p>
        {report.overdueMilestonesByTeam.length === 0 ? (
          <p className='text-muted-foreground text-sm'>None.</p>
        ) : (
          <ul className='flex flex-col gap-1'>
            {report.overdueMilestonesByTeam.map((row) => (
              <li key={row.team} className='flex items-center justify-between text-sm'>
                <span className='capitalize'>{row.team}</span>
                <span className='text-muted-foreground'>{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Previously mapped through Badge's default/secondary/destructive variants, which meant
// "amber" rendered as the primary blue badge and "green" as plain gray — neither read as
// its actual color. Uses the shared Tone palette instead so the traffic-light metaphor
// (green/amber/red) actually shows green/amber/red.
const HEALTH_TONE: Record<ProjectHealthRow['health'], Tone> = {
  green: 'success',
  amber: 'caution',
  red: 'destructive'
};

export function ProjectHealthTable({ rows }: { rows: ProjectHealthRow[] }) {
  if (rows.length === 0)
    return <p className='text-muted-foreground text-sm'>No active projects.</p>;

  return (
    <div className='overflow-hidden rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className='text-right'>Open tasks</TableHead>
            <TableHead className='text-right'>Overdue tasks</TableHead>
            <TableHead className='text-right'>Overdue milestones</TableHead>
            <TableHead>Health</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className='font-medium'>{row.name}</TableCell>
              <TableCell className='text-muted-foreground'>{row.clientName}</TableCell>
              <TableCell className='text-muted-foreground capitalize'>{row.team}</TableCell>
              <TableCell className='text-right'>{row.openTaskCount}</TableCell>
              <TableCell className='text-right'>{row.overdueTaskCount}</TableCell>
              <TableCell className='text-right'>{row.overdueMilestoneCount}</TableCell>
              <TableCell>
                <StatusBadge tone={HEALTH_TONE[row.health]} className='capitalize'>
                  {row.health}
                </StatusBadge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
