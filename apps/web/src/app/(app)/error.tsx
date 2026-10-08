'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/error-state';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="space-y-6">
      <ErrorState reset={reset} />
    </section>
  );
}
