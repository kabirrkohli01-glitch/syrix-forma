'use client';

import { RouteError } from '@/components/layout/route-error';

export default function ProjectsError({
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
      description="This project page couldn't load. Try again, or come back in a moment."
    />
  );
}
