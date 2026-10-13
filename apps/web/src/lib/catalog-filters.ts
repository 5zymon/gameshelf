import type { ListGamesQuery, SortDirection } from '@/lib/api';

/** Sort fields the catalog UI exposes (the API also accepts platform/createdAt). */
export type CatalogSortField = 'title' | 'year';

/** The 5.3 filter params plus the catalog sort; all supported by GET /games. */
export type CatalogFilterValues = Pick<
  ListGamesQuery,
  | 'platformId'
  | 'edition'
  | 'year'
  | 'publisher'
  | 'genre'
  | 'playerCount'
  | 'q'
> & {
  /** Both-or-neither; absent means DEFAULT_SORT. Never set to the default pair. */
  sort?: CatalogSortField;
  order?: SortDirection;
};

export const SORT_OPTIONS = [
  'title-asc',
  'title-desc',
  'year-desc',
  'year-asc',
] as const;
export type CatalogSortOption = (typeof SORT_OPTIONS)[number];
export const DEFAULT_SORT = { sort: 'title', order: 'asc' } as const;

export type CatalogSearchParams = Record<string, string | string[] | undefined>;

export const FILTER_KEYS = [
  'platformId',
  'edition',
  'year',
  'publisher',
  'genre',
  'playerCount',
  'q',
] as const satisfies readonly (keyof CatalogFilterValues)[];

const MAX_TEXT = 255;

function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** '' / non-numeric / out-of-range → undefined (dropped, never sent → no 400). */
function boundedInt(
  v: string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= min && n <= max ? n : undefined;
}

function text(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' || t.length > MAX_TEXT ? undefined : t;
}

export function parseCatalogFilters(
  params: CatalogSearchParams,
): CatalogFilterValues {
  const values: CatalogFilterValues = {};
  const platformId = boundedInt(
    firstValue(params.platformId),
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (platformId !== undefined) values.platformId = platformId;
  const year = boundedInt(firstValue(params.year), 1000, 2100);
  if (year !== undefined) values.year = year;
  const playerCount = boundedInt(firstValue(params.playerCount), 1, 100);
  if (playerCount !== undefined) values.playerCount = playerCount;
  const edition = text(firstValue(params.edition));
  if (edition !== undefined) values.edition = edition;
  const publisher = text(firstValue(params.publisher));
  if (publisher !== undefined) values.publisher = publisher;
  const genre = text(firstValue(params.genre));
  if (genre !== undefined) values.genre = genre;
  const q = text(firstValue(params.q));
  if (q !== undefined) values.q = q;
  const sort = firstValue(params.sort);
  if (sort === 'title' || sort === 'year') {
    const order: SortDirection =
      firstValue(params.order) === 'desc' ? 'desc' : 'asc';
    if (!(sort === DEFAULT_SORT.sort && order === DEFAULT_SORT.order)) {
      values.sort = sort;
      values.order = order;
    }
  }
  return values;
}

export function hasActiveFilters(values: CatalogFilterValues): boolean {
  return FILTER_KEYS.some((key) => values[key] !== undefined);
}

/** Committed values → the select's option value. */
export function sortOptionOf(
  values: Pick<CatalogFilterValues, 'sort' | 'order'>,
): CatalogSortOption {
  const candidate = `${values.sort ?? 'title'}-${values.order ?? 'asc'}`;
  return (SORT_OPTIONS as readonly string[]).includes(candidate)
    ? (candidate as CatalogSortOption)
    : 'title-asc';
}

/** Select option → URL overrides; the default clears both keys explicitly (undefined removes). */
export function sortOverrides(
  option: CatalogSortOption,
): Pick<CatalogFilterValues, 'sort' | 'order'> {
  if (option === 'title-asc') return { sort: undefined, order: undefined };
  const [sort, order] = option.split('-');
  return { sort: sort as CatalogSortField, order: order as SortDirection };
}

/** Builds `/?…` from valid values only; always drops `page` (a filter change starts a new result set). */
export function catalogHref(values: CatalogFilterValues): string {
  const params = new URLSearchParams();
  if (values.platformId !== undefined)
    params.set('platformId', String(values.platformId));
  if (values.edition !== undefined) params.set('edition', values.edition);
  if (values.year !== undefined) params.set('year', String(values.year));
  if (values.publisher !== undefined) params.set('publisher', values.publisher);
  if (values.genre !== undefined) params.set('genre', values.genre);
  if (values.playerCount !== undefined)
    params.set('playerCount', String(values.playerCount));
  if (values.q !== undefined) params.set('q', values.q);
  if (values.sort !== undefined) params.set('sort', values.sort);
  if (values.order !== undefined) params.set('order', values.order);
  const qs = params.toString();
  return qs === '' ? '/' : `/?${qs}`;
}
