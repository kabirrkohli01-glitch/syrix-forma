'use client';

import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { Icons } from '@/components/icons';
import { DataTable } from '@/components/ui/table/data-table';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDataTable } from '@/hooks/use-data-table';
import { CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE } from '@/lib/status-colors';
import type { clientStatusEnum } from '@/lib/db/schema';

export type ClientListRow = {
  id: string;
  name: string;
  serviceLine: string | null;
  team: string;
  status: (typeof clientStatusEnum.enumValues)[number];
};

const columns: ColumnDef<ClientListRow>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Name' />,
    cell: ({ row }) => (
      <span className='flex min-w-0 items-center gap-2'>
        <Icons.teams className='text-muted-foreground size-4 shrink-0' />
        <Link
          href={`/dashboard/clients/${row.original.id}`}
          className='truncate font-medium hover:underline'
        >
          {row.original.name}
        </Link>
      </span>
    )
  },
  {
    accessorKey: 'serviceLine',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Service line' />,
    cell: ({ row }) => (
      <span className='text-muted-foreground truncate'>{row.original.serviceLine ?? '—'}</span>
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
      <StatusBadge tone={CLIENT_STATUS_TONE[row.original.status]}>
        {CLIENT_STATUS_LABEL[row.original.status]}
      </StatusBadge>
    ),
    enableColumnFilter: true,
    meta: {
      label: 'Status',
      variant: 'multiSelect',
      options: Object.entries(CLIENT_STATUS_LABEL).map(([value, label]) => ({ label, value }))
    }
  }
];

export function ClientsTable({ data, pageCount }: { data: ClientListRow[]; pageCount: number }) {
  const { table } = useDataTable({
    columns,
    data,
    pageCount,
    initialState: { sorting: [{ id: 'name', desc: false }] }
  });

  return (
    <DataTable
      table={table}
      renderMobileCard={(client) => (
        <Link href={`/dashboard/clients/${client.id}`} className='flex flex-col gap-1.5'>
          <div className='flex items-center justify-between gap-2'>
            <span className='flex min-w-0 items-center gap-2 font-medium'>
              <Icons.teams className='text-muted-foreground size-4 shrink-0' />
              <span className='truncate'>{client.name}</span>
            </span>
            <StatusBadge tone={CLIENT_STATUS_TONE[client.status]} className='shrink-0'>
              {CLIENT_STATUS_LABEL[client.status]}
            </StatusBadge>
          </div>
          <p className='text-muted-foreground truncate pl-6 text-xs capitalize'>
            {client.serviceLine ?? '—'} · {client.team}
          </p>
        </Link>
      )}
    >
      <DataTableToolbar table={table} />
    </DataTable>
  );
}
