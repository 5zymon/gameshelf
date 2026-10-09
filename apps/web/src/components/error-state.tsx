'use client';

import { useTranslations } from 'next-intl';
import { startTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60';

const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';

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
  const t = useTranslations('common');

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
      <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">
        {t('errorTitle')}
      </h1>
      <p className="text-sm text-muted">{t('errorBody')}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <button type="button" onClick={retry} className={PRIMARY_BUTTON}>
          {t('tryAgain')}
        </button>
        {showCatalogLink && (
          <Link href="/" className={SECONDARY_BUTTON}>
            {t('backToCatalog')}
          </Link>
        )}
        {onReload && (
          <button type="button" onClick={onReload} className={SECONDARY_BUTTON}>
            {t('reloadPage')}
          </button>
        )}
      </div>
    </div>
  );
}
