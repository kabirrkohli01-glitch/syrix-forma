import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div className='flex flex-1 flex-col gap-4 px-4 pt-2 pb-4 md:px-6 md:pt-4' role='status' aria-label='Loading dashboard'>
      {/* Capped rather than fixed. `w-80` is 320px, the width of the narrowest phone, so with the
          page padding either side it overflowed and the loading state scrolled sideways before the
          screen it precedes had even rendered. */}
      <div>
        <Skeleton className='mb-2 h-8 w-full max-w-64' />
        <Skeleton className='h-4 w-full max-w-80' />
      </div>
      <div className='grid flex-1 grid-cols-1 gap-4 md:grid-cols-3'>
        {[0, 1, 2].map((i) => (
          <div key={i} className='rounded-xl border p-4'>
            <Skeleton className='mb-3 h-5 w-24' />
            <Skeleton className='mb-2 h-12 w-full' />
            <Skeleton className='h-12 w-full' />
          </div>
        ))}
      </div>
    </div>
  );
}
