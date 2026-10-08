import Link from 'next/link';
import { redirect } from 'next/navigation';
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

  const { items, meta, filters: options } = games;
  const active = hasActiveFilters(filters);
  if (meta.total === 0 && !active) return <EmptyCatalog />;

  const first = (meta.page - 1) * meta.limit + 1;
  const last = first + items.length - 1;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Your shelf
        </h1>
        {items.length > 0 && (
          <p className="text-sm text-muted">
            {active
              ? `Showing ${String(first)}–${String(last)} of ${String(meta.total)} matching games`
              : `Showing ${String(first)}–${String(last)} of ${String(meta.total)} games`}
          </p>
        )}
      </header>

      <CatalogFilterBar
        values={filters}
        platforms={options.platforms}
        editions={options.editions}
      />

      {meta.total === 0 ? (
        <NoResults />
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-edge/70 bg-shelf/30 px-6 py-10">
          <p className="text-sm text-muted">
            That page has no games.{' '}
            <Link
              href={pageHref(params, 1)}
              className="text-accent underline-offset-4 hover:underline hover:text-accent-strong"
            >
              Back to the first page
            </Link>
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
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

function EmptyCatalog(): React.ReactElement {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Your shelf
        </h1>
      </header>
      <div className="rounded-lg border border-edge/70 bg-shelf/30 px-6 py-12 text-left">
        <span aria-hidden className="mb-4 block h-0.5 w-10 bg-accent" />
        <h2 className="text-lg font-medium text-fog">
          Nothing on the shelf yet
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          Add a game by hand, or import photos of your shelf to fill it in.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/games/new"
            className="rounded-md bg-accent px-4 py-2 font-medium text-ink hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          >
            Add a game
          </Link>
          <Link
            href="/import"
            className="rounded-md border border-edge px-4 py-2 font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Import from photos
          </Link>
        </div>
      </div>
    </section>
  );
}

function NoResults(): React.ReactElement {
  return (
    <div className="rounded-lg border border-edge/70 bg-shelf/30 px-6 py-12 text-left">
      <span aria-hidden className="mb-4 block h-0.5 w-10 bg-accent" />
      <h2 className="text-lg font-medium text-fog">
        No games match these filters
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted">
        Try broadening your search or removing a filter.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md border border-edge px-4 py-2 font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Clear all filters
      </Link>
    </div>
  );
}
