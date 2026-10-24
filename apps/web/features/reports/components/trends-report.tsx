import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import type { WeeklyTrendRow } from '../utils/queries';

export function TrendsTable({ rows }: { rows: WeeklyTrendRow[] }) {
  return (
    <div className='overflow-hidden rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Week of</TableHead>
            <TableHead className='text-right'>Tasks created</TableHead>
            <TableHead className='text-right'>Enquiries created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.weekStart.toISOString()}>
              <TableCell className='font-medium'>{format(row.weekStart, 'MMM d, yyyy')}</TableCell>
              <TableCell className='text-right'>{row.tasksCreated}</TableCell>
              <TableCell className='text-right'>{row.enquiriesCreated}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
