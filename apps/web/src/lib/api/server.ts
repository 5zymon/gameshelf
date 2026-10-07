import { cache } from 'react';
import { cookies } from 'next/headers';
import type { AuthUser, ListGamesQuery, ListGamesResponse } from './contracts';
import { createApiClient, type Transport } from './client';
import { isApiError } from './errors';

const API_ORIGIN = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
).replace(/\/+$/, '');

const transport: Transport = {
  baseUrl: API_ORIGIN,
  defaultInit: { cache: 'no-store' },
  getHeaders: async (): Promise<HeadersInit> => {
    const cookie = (await cookies()).toString();
    return cookie === '' ? {} : { cookie };
  },
};

/** Server-side client: talks to the API origin and forwards the session cookie. */
export const api = createApiClient(transport);

/** 401 → null (not signed in). Cached per request so layout+page share one call. */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  try {
    return await api.auth.me();
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null;
    throw error;
  }
});

export async function getSetupStatus(): Promise<boolean> {
  return (await api.setup.status()).setupRequired;
}

/** Default page size preserved from the old helper (limit=24). 401 → null. */
export async function getGames(
  query?: ListGamesQuery,
): Promise<ListGamesResponse | null> {
  try {
    return await api.games.list({ limit: 24, ...query });
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null;
    throw error;
  }
}
