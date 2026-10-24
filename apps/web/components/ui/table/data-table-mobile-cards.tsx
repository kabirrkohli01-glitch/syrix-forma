import type { Table as TanstackTable } from '@tanstack/react-table';
import type * as React from 'react';
import { Card } from '@/components/ui/card';

/**
 * Row-per-card fallback for narrow viewports — swapped in by DataTable (see its
 * `renderMobileCard` prop) instead of the table just horizontally scrolling, per
 * engineering rule 3's "responsive cards" requirement for mobile. Each card is the
 * row's click target where `renderCard` returns a link/interactive content, so it
 * uses Card's `interactive` variant for press/hover feedback.
 */
export function DataTableMobileCards<TData>({
  table,
  renderCard
}: {
  table: TanstackTable<TData>;
  renderCard: (row: TData) => React.ReactNode;
}) {
  const rows = table.getRowModel().rows;

  if (rows.length === 0) {
    return <p className='text-muted-foreground p-6 text-center text-sm'>No results.</p>;
  }

  return (
    <div className='flex flex-col gap-2'>
      {rows.map((row) => (
        <Card key={row.id} interactive size='sm'>
          {renderCard(row.original)}
        </Card>
      ))}
    </div>
  );
}
