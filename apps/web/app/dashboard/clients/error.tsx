'use client';

import { RouteError } from '@/components/layout/route-error';

export default function ClientsError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      description="This client page couldn't load. Try again, or come back in a moment."
    />
  );
}
