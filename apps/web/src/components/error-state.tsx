'use client';

import { startTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function ErrorState({
  reset,
  showCatalogLink = true,
  onReload,
}: {
  reset: () => void;
  /**
   * The root boundary re-enters the failing `(app)/layout.tsx` if it links to
   * the catalog, so it hides that secondary action and keeps only "Try again".
   */
  showCatalogLink?: boolean;
  /**
   * Optional full-page reload fallback. Used by the root boundary, where the
   * failing fetch may live in a parent/app layout (`(app)/layout.tsx` —
   * `requireUser()`). **Try again** re-runs the server render
   * (`router.refresh()` + `reset()`); this full document reload is the
   * guaranteed fallback because it re-runs the server render end to end.
   */
  onReload?: () => void;
}): React.ReactElement {
  const router = useRouter();

  function retry(): void {
    // `reset()` alone only re-renders the client tree; it does not re-request
    // the RSC payload that threw. `router.refresh()` refetches the current
    // route's server render. Ordering: refresh first so the re-render is
    // already in flight when the boundary clears, then reset. Both run inside
    // `startTransition` so React treats the re-render as non-urgent and keeps
    // the error UI until the new payload is ready (no fallback flash).
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div className="flex max-w-md flex-col items-start gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-fog">
        Something went wrong
      </h1>
      <p className="text-sm text-muted">
        The shelf didn’t respond. Check your connection, then try again.
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={retry}
          className="rounded-md bg-accent px-4 py-2 font-medium text-ink hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
        >
          Try again
        </button>
        {showCatalogLink && (
          <Link
            href="/"
            className="rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Back to catalog
          </Link>
        )}
        {onReload && (
          <button
            type="button"
            onClick={onReload}
            className="rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Reload page
          </button>
        )}
      </div>
    </div>
  );
}
