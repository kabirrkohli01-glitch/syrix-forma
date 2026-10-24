import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProjectsLoading() {
  return (
    <PageContainer pageTitle='Projects' pageDescription='Every project you have visibility into.'>
      <div className='rounded-lg border p-4'>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className='mb-2 h-10 w-full last:mb-0' />
        ))}
      </div>
    </PageContainer>
  );
}
