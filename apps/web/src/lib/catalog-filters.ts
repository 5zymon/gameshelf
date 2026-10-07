import type { ListGamesQuery } from '@/lib/api';

/** The 5.3 filter params, all supported by GET /games (ticket 1.3). */
export type CatalogFilterValues = Pick<
  ListGamesQuery,
  | 'platformId'
  | 'edition'
  | 'year'
  | 'publisher'
  | 'genre'
  | 'playerCount'
  | 'q'
>;

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
  return values;
}

export function hasActiveFilters(values: CatalogFilterValues): boolean {
  return FILTER_KEYS.some((key) => values[key] !== undefined);
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
  const qs = params.toString();
  return qs === '' ? '/' : `/?${qs}`;
}
