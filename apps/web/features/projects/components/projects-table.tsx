'use client';

import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { Icons } from '@/components/icons';
import { DataTable } from '@/components/ui/table/data-table';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDataTable } from '@/hooks/use-data-table';
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from '@/lib/status-colors';
import type { projectStatusEnum } from '@/lib/db/schema';

export type ProjectListRow = {
  id: string;
  name: string;
  team: string;
  status: (typeof projectStatusEnum.enumValues)[number];
  clientName: string;
};

const columns: ColumnDef<ProjectListRow>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Name' />,
    cell: ({ row }) => (
      <span className='flex min-w-0 items-center gap-2'>
        <Icons.workspace className='text-muted-foreground size-4 shrink-0' />
        <Link
          href={`/dashboard/projects/${row.original.id}`}
          className='truncate font-medium hover:underline'
        >
          {row.original.name}
        </Link>
      </span>
    )
  },
  {
    accessorKey: 'clientName',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Client' />,
    cell: ({ row }) => (
      <span className='text-muted-foreground truncate'>{row.original.clientName}</span>
    )
  },
  {
    accessorKey: 'team',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Team' />,
    cell: ({ row }) => (
      <span className='text-muted-foreground truncate capitalize'>{row.original.team}</span>
    )
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Status' />,
    cell: ({ row }) => (
      <StatusBadge tone={PROJECT_STATUS_TONE[row.original.status]}>
        {PROJECT_STATUS_LABEL[row.original.status]}
      </StatusBadge>
    ),
    enableColumnFilter: true,
    meta: {
      label: 'Status',
      variant: 'multiSelect',
      options: Object.entries(PROJECT_STATUS_LABEL).map(([value, label]) => ({ label, value }))
    }
  }
];

export function ProjectsTable({ data, pageCount }: { data: ProjectListRow[]; pageCount: number }) {
  const { table } = useDataTable({
    columns,
    data,
    pageCount,
    initialState: { sorting: [{ id: 'name', desc: false }] }
  });

  return (
    <DataTable
      table={table}
      renderMobileCard={(project) => (
        <Link href={`/dashboard/projects/${project.id}`} className='flex flex-col gap-1.5'>
          <div className='flex items-center justify-between gap-2'>
            <span className='flex min-w-0 items-center gap-2 font-medium'>
              <Icons.workspace className='text-muted-foreground size-4 shrink-0' />
              <span className='truncate'>{project.name}</span>
            </span>
            <StatusBadge tone={PROJECT_STATUS_TONE[project.status]} className='shrink-0'>
              {PROJECT_STATUS_LABEL[project.status]}
            </StatusBadge>
          </div>
          <p className='text-muted-foreground truncate pl-6 text-xs capitalize'>
            {project.clientName} · {project.team}
          </p>
        </Link>
      )}
    >
      <DataTableToolbar table={table} />
    </DataTable>
  );
}
