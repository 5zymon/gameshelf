import type {
  AuthUser,
  CreateGameRequest,
  CreatePlatformRequest,
  DismissImportJobRequest,
  DismissUnrecognizedItemRequest,
  EnrichGameRequest,
  EnrichGameResponse,
  GameDetail,
  GameSearchResponse,
  ImportBatchProgress,
  ImportJobDetail,
  ImportQueueState,
  ListGamesQuery,
  ListGamesResponse,
  ListImportJobsQuery,
  ListImportJobsResponse,
  LoginRequest,
  LoginResponse,
  MergePlatformRequest,
  Platform,
  SearchGamesQuery,
  SetupRequest,
  SetupResponse,
  SetupStatus,
  StartImportUploadResponse,
  UnrecognizedItem,
  UpdateGameRequest,
  UpdatePlatformRequest,
} from './contracts';
import { ApiError, apiErrorFromResponse } from './errors';
import { buildQueryString, gamesListQuery, importJobsListQuery } from './query';

/**
 * Where the client sends every request and how credentials/cookies are
 * attached. Server: the API origin + the forwarded session cookie. Browser:
 * the relative `/api` rewrite prefix and same-origin credentials.
 */
export interface Transport {
  /** Server: API origin. Browser: '/api' (the Next rewrite prefix). */
  baseUrl: string;
  /** Merged into every fetch (server: cache; browser: credentials/cache). */
  defaultInit?: RequestInit;
  /** Per-request headers (server forwards the session cookie). */
  getHeaders?: () => HeadersInit | Promise<HeadersInit>;
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
}

/** GET helper. */
function getInit(options?: ApiRequestOptions): RequestInit {
  return { method: 'GET', signal: options?.signal };
}

/** JSON body helper — the only place `content-type` is set. */
function jsonInit(
  method: 'POST' | 'PATCH' | 'PUT',
  body: unknown,
  options?: ApiRequestOptions,
): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: options?.signal,
  };
}

function noBodyInit(
  method: 'POST' | 'DELETE',
  options?: ApiRequestOptions,
): RequestInit {
  return { method, signal: options?.signal };
}

async function request<T>(
  transport: Transport,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${transport.baseUrl}${path}`;
  const headers = new Headers(transport.defaultInit?.headers);
  if (transport.getHeaders !== undefined) {
    const extra = new Headers(await transport.getHeaders());
    extra.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  new Headers(init?.headers).forEach((value, key) => {
    headers.set(key, value);
  });

  let response: Response;
  try {
    response = await fetch(url, { ...transport.defaultInit, ...init, headers });
  } catch (cause) {
    throw new ApiError({
      status: 0,
      url,
      body: null,
      code: 'NETWORK_ERROR',
      cause,
      message: `Network request failed: ${init?.method ?? 'GET'} ${path}`,
    });
  }
  if (!response.ok) throw await apiErrorFromResponse(response, url);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (text === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new ApiError({
      status: response.status,
      url,
      body: text,
      code: 'INVALID_RESPONSE',
      cause,
      message: 'The server returned an invalid JSON response',
    });
  }
}

/** The full typed surface of the catalog, import, auth and setup endpoints. */
export interface ApiClient {
  games: {
    list(
      query?: ListGamesQuery,
      options?: ApiRequestOptions,
    ): Promise<ListGamesResponse>;
    search(
      query: SearchGamesQuery,
      options?: ApiRequestOptions,
    ): Promise<GameSearchResponse>;
    get(id: number, options?: ApiRequestOptions): Promise<GameDetail>;
    create(
      body: CreateGameRequest,
      options?: ApiRequestOptions,
    ): Promise<GameDetail>;
    addCopy(id: number, options?: ApiRequestOptions): Promise<GameDetail>;
    update(
      id: number,
      body: UpdateGameRequest,
      options?: ApiRequestOptions,
    ): Promise<GameDetail>;
    remove(id: number, options?: ApiRequestOptions): Promise<void>;
    enrich(
      id: number,
      body?: EnrichGameRequest,
      options?: ApiRequestOptions,
    ): Promise<EnrichGameResponse>;
  };
  platforms: {
    list(options?: ApiRequestOptions): Promise<Platform[]>;
    get(id: number, options?: ApiRequestOptions): Promise<Platform>;
    create(
      body: CreatePlatformRequest,
      options?: ApiRequestOptions,
    ): Promise<Platform>;
    update(
      id: number,
      body: UpdatePlatformRequest,
      options?: ApiRequestOptions,
    ): Promise<Platform>;
    confirm(id: number, options?: ApiRequestOptions): Promise<Platform>;
    merge(
      id: number,
      body: MergePlatformRequest,
      options?: ApiRequestOptions,
    ): Promise<Platform>;
    remove(id: number, options?: ApiRequestOptions): Promise<void>;
  };
  importJobs: {
    list(
      query?: ListImportJobsQuery,
      options?: ApiRequestOptions,
    ): Promise<ListImportJobsResponse>;
    get(id: number, options?: ApiRequestOptions): Promise<ImportJobDetail>;
    getBatch(
      batchId: string,
      options?: ApiRequestOptions,
    ): Promise<ImportBatchProgress>;
    retry(id: number, options?: ApiRequestOptions): Promise<ImportJobDetail>;
    resume(options?: ApiRequestOptions): Promise<ImportQueueState>;
    listUnrecognized(
      id: number,
      options?: ApiRequestOptions,
    ): Promise<UnrecognizedItem[]>;
    dismiss(id: number, options?: ApiRequestOptions): Promise<ImportJobDetail>;
    dismissUnrecognizedItem(
      id: number,
      itemId: number,
      options?: ApiRequestOptions,
    ): Promise<UnrecognizedItem>;
  };
  importUpload: {
    upload(
      files: readonly File[],
      declaredCounts?: readonly string[],
      options?: ApiRequestOptions,
    ): Promise<StartImportUploadResponse>;
  };
  auth: {
    login(
      body: LoginRequest,
      options?: ApiRequestOptions,
    ): Promise<LoginResponse>;
    logout(options?: ApiRequestOptions): Promise<void>;
    me(options?: ApiRequestOptions): Promise<AuthUser>;
  };
  setup: {
    status(options?: ApiRequestOptions): Promise<SetupStatus>;
    create(
      body: SetupRequest,
      options?: ApiRequestOptions,
    ): Promise<SetupResponse>;
  };
}

export function createApiClient(transport: Transport): ApiClient {
  return {
    games: {
      list: (query, options) =>
        request<ListGamesResponse>(
          transport,
          `/games${gamesListQuery(query)}`,
          getInit(options),
        ),
      search: (query, options) =>
        request<GameSearchResponse>(
          transport,
          `/games/search${buildQueryString({ q: query.q })}`,
          getInit(options),
        ),
      get: (id, options) =>
        request<GameDetail>(
          transport,
          `/games/${String(id)}`,
          getInit(options),
        ),
      create: (body, options) =>
        request<GameDetail>(
          transport,
          '/games',
          jsonInit('POST', body, options),
        ),
      addCopy: (id, options) =>
        request<GameDetail>(
          transport,
          `/games/${String(id)}/copies`,
          noBodyInit('POST', options),
        ),
      update: (id, body, options) =>
        request<GameDetail>(
          transport,
          `/games/${String(id)}`,
          jsonInit('PATCH', body, options),
        ),
      remove: (id, options) =>
        request(
          transport,
          `/games/${String(id)}`,
          noBodyInit('DELETE', options),
        ),
      enrich: (id, body = {}, options) =>
        request<EnrichGameResponse>(
          transport,
          `/games/${String(id)}/enrich`,
          jsonInit('POST', body, options),
        ),
    },
    platforms: {
      list: (options) =>
        request<Platform[]>(transport, '/platforms', getInit(options)),
      get: (id, options) =>
        request<Platform>(
          transport,
          `/platforms/${String(id)}`,
          getInit(options),
        ),
      create: (body, options) =>
        request<Platform>(
          transport,
          '/platforms',
          jsonInit('POST', body, options),
        ),
      update: (id, body, options) =>
        request<Platform>(
          transport,
          `/platforms/${String(id)}`,
          jsonInit('PATCH', body, options),
        ),
      confirm: (id, options) =>
        request<Platform>(
          transport,
          `/platforms/${String(id)}/confirm`,
          noBodyInit('POST', options),
        ),
      merge: (id, body, options) =>
        request<Platform>(
          transport,
          `/platforms/${String(id)}/merge`,
          jsonInit('POST', body, options),
        ),
      remove: (id, options) =>
        request(
          transport,
          `/platforms/${String(id)}`,
          noBodyInit('DELETE', options),
        ),
    },
    importJobs: {
      list: (query, options) =>
        request<ListImportJobsResponse>(
          transport,
          `/import-jobs${importJobsListQuery(query)}`,
          getInit(options),
        ),
      get: (id, options) =>
        request<ImportJobDetail>(
          transport,
          `/import-jobs/${String(id)}`,
          getInit(options),
        ),
      getBatch: (batchId, options) =>
        request<ImportBatchProgress>(
          transport,
          `/import-jobs/batches/${encodeURIComponent(batchId)}`,
          getInit(options),
        ),
      retry: (id, options) =>
        request<ImportJobDetail>(
          transport,
          `/import-jobs/${String(id)}/retry`,
          noBodyInit('POST', options),
        ),
      resume: (options) =>
        request<ImportQueueState>(
          transport,
          '/import-jobs/resume',
          noBodyInit('POST', options),
        ),
      listUnrecognized: (id, options) =>
        request<UnrecognizedItem[]>(
          transport,
          `/import-jobs/${String(id)}/unrecognized`,
          getInit(options),
        ),
      dismiss: (id, options) =>
        request<ImportJobDetail>(
          transport,
          `/import-jobs/${String(id)}`,
          jsonInit(
            'PATCH',
            { status: 'dismissed' } satisfies DismissImportJobRequest,
            options,
          ),
        ),
      dismissUnrecognizedItem: (id, itemId, options) =>
        request<UnrecognizedItem>(
          transport,
          `/import-jobs/${String(id)}/unrecognized/${String(itemId)}`,
          jsonInit(
            'PATCH',
            { dismissed: true } satisfies DismissUnrecognizedItemRequest,
            options,
          ),
        ),
    },
    importUpload: {
      upload: (files, declaredCounts, options) => {
        const form = new FormData();
        for (const file of files) form.append('files', file);
        for (const count of declaredCounts ?? []) {
          form.append('declaredCounts', count);
        }
        // No content-type: the browser sets the multipart boundary.
        return request<StartImportUploadResponse>(transport, '/import/upload', {
          method: 'POST',
          body: form,
          signal: options?.signal,
        });
      },
    },
    auth: {
      login: (body, options) =>
        request<LoginResponse>(
          transport,
          '/auth/login',
          jsonInit('POST', body, options),
        ),
      logout: (options) =>
        request(transport, '/auth/logout', noBodyInit('POST', options)),
      me: (options) =>
        request<AuthUser>(transport, '/auth/me', getInit(options)),
    },
    setup: {
      status: (options) =>
        request<SetupStatus>(transport, '/setup/status', getInit(options)),
      create: (body, options) =>
        request<SetupResponse>(
          transport,
          '/setup',
          jsonInit('POST', body, options),
        ),
    },
  };
}
