'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/error-state';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    console.error(error);
  }, [error]);

  function reload(): void {
    window.location.reload();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6">
      <ErrorState reset={reset} showCatalogLink={false} onReload={reload} />
    </main>
  );
}
