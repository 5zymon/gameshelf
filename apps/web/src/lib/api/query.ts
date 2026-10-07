import type { ListGamesQuery, ListImportJobsQuery } from './contracts';

export type QueryParamValue = string | number | boolean | null | undefined;

/** Builds `?a=1&b=2`, dropping `undefined`/`null`/`''`; returns `''` when empty. */
export function buildQueryString(
  params: Record<string, QueryParamValue>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

export function gamesListQuery(query: ListGamesQuery = {}): string {
  return buildQueryString({
    page: query.page,
    limit: query.limit,
    platformId: query.platformId,
    edition: query.edition,
    year: query.year,
    publisher: query.publisher,
    genre: query.genre,
    playerCount: query.playerCount,
    q: query.q,
    sort: query.sort,
    order: query.order,
  });
}

export function importJobsListQuery(query: ListImportJobsQuery = {}): string {
  return buildQueryString({
    page: query.page,
    limit: query.limit,
    status: query.status,
    batchId: query.batchId,
  });
}
