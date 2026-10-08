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
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6">
      <div className="nocturne-glow" aria-hidden="true" />
      <div className="relative z-[1] w-full">
        <ErrorState reset={reset} showCatalogLink={false} onReload={reload} />
      </div>
    </main>
  );
}
