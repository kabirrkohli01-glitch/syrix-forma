import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import type { EmployeeWorkload, TeamWorkload } from '../utils/queries';

export function WorkloadByEmployeeTable({ rows }: { rows: EmployeeWorkload[] }) {
  if (rows.length === 0)
    return <p className='text-muted-foreground text-sm'>No active employees.</p>;

  return (
    <div className='overflow-hidden rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Team</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className='text-right'>Open</TableHead>
            <TableHead className='text-right'>In progress</TableHead>
            <TableHead className='text-right'>Overdue</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className='font-medium'>{row.name}</TableCell>
              <TableCell className='text-muted-foreground'>{row.team ?? '—'}</TableCell>
              <TableCell className='text-muted-foreground'>{row.role ?? '—'}</TableCell>
              <TableCell className='text-right'>{row.openCount}</TableCell>
              <TableCell className='text-right'>{row.inProgressCount}</TableCell>
              <TableCell className='text-right'>
                {row.overdueCount > 0 ? <Badge variant='destructive'>{row.overdueCount}</Badge> : 0}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function WorkloadByTeamTable({ rows }: { rows: TeamWorkload[] }) {
  if (rows.length === 0) return <p className='text-muted-foreground text-sm'>No teams yet.</p>;

  return (
    <div className='overflow-hidden rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Team</TableHead>
            <TableHead className='text-right'>Members</TableHead>
            <TableHead className='text-right'>Open tasks</TableHead>
            <TableHead className='text-right'>Overdue</TableHead>
            <TableHead className='text-right'>Unassigned</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.team}>
              <TableCell className='font-medium capitalize'>{row.team}</TableCell>
              <TableCell className='text-right'>{row.memberCount}</TableCell>
              <TableCell className='text-right'>{row.openCount}</TableCell>
              <TableCell className='text-right'>
                {row.overdueCount > 0 ? <Badge variant='destructive'>{row.overdueCount}</Badge> : 0}
              </TableCell>
              <TableCell className='text-right'>{row.unassignedOpenCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
