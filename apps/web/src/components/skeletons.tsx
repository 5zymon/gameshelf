import { getTranslations } from 'next-intl/server';

/**
 * Route-level loading skeletons. Server components: no interactivity, only the
 * same geometry as the real content so the fallback→content swap does not shift
 * layout. Kept in one module so the catalog and detail skeletons stay in sync.
 */

const GRID =
  'grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-[18px] lg:grid-cols-4 xl:grid-cols-5';
const PULSE = 'animate-pulse motion-reduce:animate-none';
/** Mirrors CatalogPage PAGE_SIZE (24) so the default page-1 geometry matches. */
const SKELETON_TILES = 24;

export function SkeletonBlock({
  className = '',
}: {
  className?: string;
}): React.ReactElement {
  return (
    <span
      aria-hidden
      className={`block rounded-control bg-surface-2 ${className}`}
    />
  );
}

export function GameCardSkeleton(): React.ReactElement {
  return (
    <li className="min-w-0">
      <div className="overflow-hidden rounded-card border border-edge bg-surface">
        <div className="aspect-[3/4] w-full bg-surface-2" />
        <div className="px-3.5 pt-3 pb-3.5">
          <SkeletonBlock className="h-5 w-3/4" />
          <SkeletonBlock className="h-4 w-1/2" />
        </div>
      </div>
    </li>
  );
}

export async function CatalogSkeleton(): Promise<React.ReactElement> {
  const t = await getTranslations('loading');
  return (
    <section className={`space-y-6 ${PULSE}`} aria-busy="true">
      <span className="sr-only">{t('catalog')}</span>
      <header className="space-y-1">
        <SkeletonBlock className="h-8 w-48" />
        <SkeletonBlock className="h-4 w-64" />
      </header>
      <div className="space-y-3 sm:space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <SkeletonBlock className="h-5 w-24" />
            <SkeletonBlock className="h-10 w-full rounded-control border border-edge" />
          </div>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <SkeletonBlock className="h-5 w-24" />
              <SkeletonBlock className="h-10 w-full rounded-control border border-edge" />
            </div>
          ))}
        </div>
      </div>
      <ul className={GRID}>
        {Array.from({ length: SKELETON_TILES }, (_, i) => (
          <GameCardSkeleton key={i} />
        ))}
      </ul>
      <div className="flex items-center justify-center gap-4">
        <SkeletonBlock className="h-9 w-24 rounded-control border border-edge" />
        <SkeletonBlock className="h-4 w-24" />
        <SkeletonBlock className="h-9 w-24 rounded-control border border-edge" />
      </div>
    </section>
  );
}

export async function GameDetailSkeleton(): Promise<React.ReactElement> {
  const t = await getTranslations('loading');
  return (
    <section className={`space-y-6 ${PULSE}`} aria-busy="true">
      <span className="sr-only">{t('gameDetail')}</span>
      <SkeletonBlock className="h-5 w-32" />
      <article className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 space-y-2">
            <SkeletonBlock className="h-8 w-64" />
            <SkeletonBlock className="h-4 w-48" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SkeletonBlock className="h-6 w-24 rounded-control" />
            <SkeletonBlock className="h-6 w-36 rounded-control" />
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
          <div className="min-w-0 max-w-[10rem] sm:max-w-[12rem] md:max-w-none">
            <div className="aspect-[3/4] w-full rounded-card border border-edge bg-surface-2" />
          </div>

          <div className="min-w-0 space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <SkeletonBlock className="h-9 w-32 rounded-control border border-edge" />
              <SkeletonBlock className="h-9 w-40 rounded-control border border-edge" />
              <SkeletonBlock className="ml-auto h-9 w-32 rounded-control border border-edge" />
            </div>

            <div className="flex gap-6 border-b border-edge pb-2.5">
              <SkeletonBlock className="h-4 w-14" />
              <SkeletonBlock className="h-4 w-14" />
            </div>

            <dl className="grid gap-x-8 sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-1 border-b border-edge-soft py-2"
                >
                  <SkeletonBlock className="h-3 w-20" />
                  <SkeletonBlock className="h-4 w-32" />
                </div>
              ))}
            </dl>
          </div>
        </div>
      </article>
    </section>
  );
}

export async function ImportProgressSkeleton(): Promise<React.ReactElement> {
  const t = await getTranslations('loading');
  return (
    <section className={`space-y-6 ${PULSE}`} aria-busy="true">
      <span className="sr-only">{t('importProgress')}</span>
      <header className="space-y-1">
        <SkeletonBlock className="h-8 w-56" />
        <SkeletonBlock className="h-4 w-72" />
      </header>
      <div className="space-y-3">
        <SkeletonBlock className="h-2 w-full rounded-full border border-edge" />
        <SkeletonBlock className="h-4 w-48" />
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="rounded-control border border-edge bg-surface-2 p-3"
            >
              <SkeletonBlock className="h-3 w-16" />
              <SkeletonBlock className="mt-0.5 h-6 w-10" />
            </div>
          ))}
        </dl>
      </div>
      <div className="space-y-2">
        <SkeletonBlock className="h-6 w-20" />
        <ul className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-control border border-edge bg-surface-2 p-3"
            >
              <SkeletonBlock className="mt-1.5 h-2 w-2 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1">
                <SkeletonBlock className="h-4 w-32" />
                <SkeletonBlock className="h-4 w-48" />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-edge pt-4">
        <SkeletonBlock className="h-9 w-32 rounded-control border border-edge" />
        <SkeletonBlock className="h-9 w-40 rounded-control border border-edge" />
      </div>
    </section>
  );
}
