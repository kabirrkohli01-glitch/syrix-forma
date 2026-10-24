'use client';

import { useEffect } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';

// Shared body for every segment's error.tsx (Next.js requires one per segment that wants a
// boundary — this is the one presentation, reused rather than copy-pasted). Sentry already
// captures errors app-wide (next.config.ts/instrumentation.ts); the console.error here is a
// local-debugging breadcrumb, not a second reporting path.
export function RouteError({
  error,
  reset,
  description = "This page hit an unexpected error. You can try again, or head back once it clears up."
}: {
  error: Error & { digest?: string };
  reset: () => void;
  description?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className='flex flex-1 items-center justify-center p-4 md:px-6'>
      <Empty className='max-w-md'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.alertCircle />
          </EmptyMedia>
          <EmptyTitle>Something went wrong</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={reset}>Try again</Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
