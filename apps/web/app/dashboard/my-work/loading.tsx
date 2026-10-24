import PageContainer from '@/components/layout/page-container';
import { DataTableSkeleton } from '@/components/ui/table/data-table-skeleton';

export default function MyWorkLoading() {
  return (
    <PageContainer pageTitle='My Work' pageDescription='Create, assign, and track tasks.'>
      <DataTableSkeleton columnCount={6} filterCount={2} />
    </PageContainer>
  );
}
