import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { TranslatorFor } from '@/i18n/translate';
import { getGames } from '@/lib/api/server';
import { CatalogFilterBar } from '@/components/catalog-filter-bar';
import { CatalogPagination } from '@/components/catalog-pagination';
import { GameCard } from '@/components/game-card';
import type { ListGamesQuery } from '@/lib/api';
import {
  hasActiveFilters,
  parseCatalogFilters,
  type CatalogSearchParams,
} from '@/lib/catalog-filters';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60';
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return 1;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Preserves every other current query param (the 5.3 filters) but `page`. */
function pageHref(searchParams: CatalogSearchParams, target: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'page') continue;
    const values = Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value];
    for (const v of values) params.append(key, v);
  }
  if (target > 1) params.set('page', String(target));
  const query = params.toString();
  return query === '' ? '/' : `/?${query}`;
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<CatalogSearchParams>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const page = parsePage(params.page);
  const filters = parseCatalogFilters(params);
  const query: ListGamesQuery = { page, limit: PAGE_SIZE, ...filters };
  const games = await getGames(query);
  if (games === null) redirect('/login');
  const t = await getTranslations('catalog');

  const { items, meta, filters: options } = games;
  const active = hasActiveFilters(filters);
  if (meta.total === 0 && !active) return <EmptyCatalog t={t} />;

  const first = (meta.page - 1) * meta.limit + 1;
  const last = first + items.length - 1;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-[clamp(27px,4.5vw,34px)] leading-[1.15] font-bold tracking-[-0.02em]">
          {t('title')}
        </h1>
        {items.length > 0 && (
          <p className="text-[15px] text-muted">
            {active
              ? t('showingFiltered', { first, last, total: meta.total })
              : t('showing', { first, last, total: meta.total })}
          </p>
        )}
      </header>

      <CatalogFilterBar
        values={filters}
        platforms={options.platforms}
        editions={options.editions}
      />

      {meta.total === 0 ? (
        <NoResults t={t} />
      ) : items.length === 0 ? (
        <div className="rounded-card border border-edge bg-surface px-6 py-10">
          <p className="text-sm text-muted">
            {t('pageEmpty')}{' '}
            <Link
              href={pageHref(params, 1)}
              className="text-accent-text underline-offset-4 hover:underline"
            >
              {t('backToFirst')}
            </Link>
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-[18px] lg:grid-cols-4 xl:grid-cols-5">
          {items.map((game, index) => (
            <GameCard key={game.id} game={game} priority={index < 4} />
          ))}
        </ul>
      )}

      <CatalogPagination
        page={meta.page}
        totalPages={meta.totalPages}
        prevHref={meta.page > 1 ? pageHref(params, meta.page - 1) : null}
        nextHref={
          meta.page < meta.totalPages ? pageHref(params, meta.page + 1) : null
        }
      />
    </section>
  );
}

function EmptyCatalog({
  t,
}: {
  t: TranslatorFor<'catalog'>;
}): React.ReactElement {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-[clamp(27px,4.5vw,34px)] leading-[1.15] font-bold tracking-[-0.02em]">
          {t('title')}
        </h1>
      </header>
      <div className="rounded-card border border-edge bg-surface p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-ink">{t('empty.title')}</h2>
        <p className="mt-2 max-w-md text-sm text-muted">{t('empty.body')}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/games/new"
            className={`${PRIMARY_BUTTON} whitespace-nowrap`}
          >
            {t('empty.addGame')}
          </Link>
          <Link href="/import" className={SECONDARY_BUTTON}>
            {t('empty.import')}
          </Link>
        </div>
      </div>
    </section>
  );
}

function NoResults({ t }: { t: TranslatorFor<'catalog'> }): React.ReactElement {
  return (
    <div className="rounded-card border border-edge bg-surface p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-ink">{t('noResults.title')}</h2>
      <p className="mt-2 max-w-md text-sm text-muted">{t('noResults.body')}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href="/" className={SECONDARY_BUTTON}>
          {t('noResults.clear')}
        </Link>
      </div>
    </div>
  );
}
