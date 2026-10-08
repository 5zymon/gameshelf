import { cache } from 'react';
import { cookies } from 'next/headers';
import type {
  AuthUser,
  GameDatabaseStatus,
  GameDetail,
  ImportBatchProgress,
  ListGamesQuery,
  ListGamesResponse,
  ListImportJobsResponse,
  LlmSettingsModel,
  Platform,
} from './contracts';
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

/** 404 → null (route calls `notFound()`); other errors propagate. */
export async function getGame(id: number): Promise<GameDetail | null> {
  try {
    return await api.games.get(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}

/** All platforms for the edit select (`GET /platforms`, sorted import-first then name). */
export async function getPlatforms(): Promise<Platform[]> {
  return api.platforms.list();
}

/** LLM readiness for the import gate. 401 → null (not signed in). */
export async function getLlmSettings(): Promise<LlmSettingsModel | null> {
  try {
    return await api.settings.llm.get();
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null;
    throw error;
  }
}

/** Game-database configuration status for the settings screen. */
export async function getGameDatabaseStatus(): Promise<GameDatabaseStatus[]> {
  return api.settings.gameDatabases.status();
}

/** Aggregated batch progress. 400/404 → null (unknown/invalid batch). */
export async function getImportBatch(
  batchId: string,
): Promise<ImportBatchProgress | null> {
  try {
    return await api.importJobs.getBatch(batchId);
  } catch (error) {
    if (isApiError(error) && (error.status === 400 || error.status === 404)) {
      return null;
    }
    throw error;
  }
}

/**
 * Every import job for a batch (up to the API's 100-row page cap). The list
 * endpoint returns newest first (createdAt DESC, id DESC); the progress view
 * re-sorts by id for stable "Photo N" ordering. Used to render per-photo rows;
 * other errors propagate.
 */
export async function getImportJobsForBatch(
  batchId: string,
): Promise<ListImportJobsResponse> {
  return api.importJobs.list({ batchId, limit: 100, page: 1 });
}
