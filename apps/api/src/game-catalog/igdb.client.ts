import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IGDB_REQUEST_TIMEOUT_MS } from '../import-jobs/import-pipeline.options';
import {
  IgdbConfigError,
  IgdbError,
  igdbErrorFromStatus,
  igdbTokenErrorFromStatus,
} from './igdb.errors';
import { IgdbHttpClient, type IgdbHttpResponse } from './igdb-http.client';
import { IgdbRateLimiter } from './igdb-rate-limiter';
import {
  IGDB_HYDRATION_MAX_IDS,
  IGDB_MAX_ATTEMPTS,
  IGDB_MULTIQUERY_MAX_QUERIES,
  IGDB_RETRY_BASE_DELAY_MS,
  IGDB_RETRY_JITTER_MS,
  IGDB_RETRY_MAX_DELAY_MS,
  IGDB_SEARCH_LIMIT,
  IGDB_TOKEN_URL_DEFAULT,
  IGDB_TOKEN_URL_ENV,
} from './igdb.options';

export const IGDB_CLIENT_ID_ENV = 'IGDB_CLIENT_ID';
export const IGDB_CLIENT_SECRET_ENV = 'IGDB_CLIENT_SECRET';

const IGDB_GAMES_URL = 'https://api.igdb.com/v4/games';
const IGDB_MULTIQUERY_URL = 'https://api.igdb.com/v4/multiquery';
const IGDB_PLATFORMS_URL = 'https://api.igdb.com/v4/platforms';
const IGDB_PLATFORMS_QUERY =
  'fields name,abbreviation,alternative_name,platform_family,slug; limit 500;';

/**
 * Exactly the fields the catalog needs. `involved_companies.company.name`
 * feeds CatalogCandidate.publisher; `summary` and `version_parent` are
 * requested by card 4.3 (version_parent is IGDB's edition/version link).
 * `summary`, `rating`, `rating_count` and `videos.*` feed card 9.1
 * (description, rating and embedded YouTube videos). Deliberately no `*` and
 * no `alternative_names`, and no `aggregated_rating` (we use the user-rating
 * `rating`, not the critic aggregate).
 */
const IGDB_GAME_FIELDS =
  'name,slug,first_release_date,cover.url,involved_companies.company.name,' +
  'genres.name,platforms.id,platforms.name,platforms.abbreviation,' +
  'summary,version_parent,multiplayer_modes.offlinemax,multiplayer_modes.onlinemax,' +
  'multiplayer_modes.offlinecoopmax,multiplayer_modes.onlinecoopmax,' +
  'screenshots.url,artworks.url,rating,rating_count,videos.id,videos.name,videos.video_id';

/** IGDB `multiplayer_modes` row (only the player-count maxima are requested). */
export interface IgdbMultiplayerMode {
  offlinemax?: number;
  onlinemax?: number;
  offlinecoopmax?: number;
  onlinecoopmax?: number;
}

/** Raw IGDB game shape (only the fields the query asks for). */
export interface IgdbGame {
  id: number;
  name: string;
  /** IGDB URL slug; the canonical page is `https://www.igdb.com/games/<slug>`. */
  slug?: string;
  first_release_date?: number;
  cover?: { url?: string };
  involved_companies?: { company?: { name?: string } }[];
  genres?: { name?: string }[];
  platforms?: { id?: number; name?: string; abbreviation?: string }[];
  summary?: string;
  /** IGDB id of the base game when this row is an edition/port; absent otherwise. */
  version_parent?: number;
  /** IGDB multiplayer modes; the max over their max fields is the player count. */
  multiplayer_modes?: IgdbMultiplayerMode[];
  /** IGDB screenshots (gameplay); used for the local gallery. */
  screenshots?: { url?: string }[];
  /** IGDB artworks (key art); used for the local gallery. */
  artworks?: { url?: string }[];
  /** IGDB user-rating average, 0–100 (double). NOT `aggregated_rating`. */
  rating?: number;
  /** IGDB user-rating vote count. */
  rating_count?: number;
  /** IGDB `game_videos`; `video_id` is the YouTube id. IGDB order is kept. */
  videos?: { id?: number; name?: string; video_id?: string }[];
}

/**
 * Raw IGDB platform shape (ticket 4.2). `platform_family` is IGDB's
 * reference id for the platform family, stored faithfully but not matched on.
 */
export interface IgdbPlatform {
  id: number;
  name: string;
  abbreviation?: string;
  alternative_name?: string;
  platform_family?: number;
  slug?: string;
}

/** Connectivity/token status surfaced by `GET /health/igdb`. */
export interface IgdbHealth {
  status: 'ok' | 'error';
  token: 'cached' | 'acquired' | 'error';
  message?: string;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

/**
 * Minimal IGDB client: OAuth client-credentials with a cached token, plus a
 * title search. Errors are `IgdbError` with a `retryable` flag; the client
 * secret is never included in an error message.
 */
@Injectable()
export class IgdbClient implements OnApplicationBootstrap {
  private readonly logger = new Logger(IgdbClient.name);
  private token: CachedToken | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(
    private readonly http: IgdbHttpClient,
    private readonly config: ConfigService,
    private readonly rateLimiter: IgdbRateLimiter,
  ) {}

  /**
   * Eager, non-blocking token warm-up so a cold process does not pay the token
   * round-trip on its first real request. Never rejects; skipped under the test
   * runner and when credentials are absent.
   */
  onApplicationBootstrap(): void {
    void this.warmUp();
  }

  async searchGames(title: string): Promise<IgdbGame[]> {
    const query =
      `search "${escapeApicalypse(title)}"; ` +
      `fields ${IGDB_GAME_FIELDS}; limit ${String(IGDB_SEARCH_LIMIT)};`;
    const response = await this.authedRequest(IGDB_GAMES_URL, query);
    const body = await this.json(response);
    if (!Array.isArray(body)) {
      throw new IgdbError(false, 'IGDB returned an unexpected response');
    }
    const games = body.filter(isIgdbGame);
    this.logger.debug(
      JSON.stringify({
        event: 'igdb_search',
        title,
        results: games.map((game) => ({ id: game.id, name: game.name })),
      }),
    );
    return games;
  }

  /**
   * Looks up up to `titles.length` titles in two phases. Phase 1 packs at most
   * `IGDB_MULTIQUERY_MAX_QUERIES` fuzzy `search` sub-queries per
   * `POST /v4/multiquery` request and collects only ids (IGDB ignores `fields`
   * for a sub-query that uses `search`). Phase 2 hydrates the unique ids with
   * the catalog fields in `/v4/games` requests of at most
   * `IGDB_HYDRATION_MAX_IDS`. Returns one candidate array per input title, in
   * input order (empty array for a title with no/malformed result). Each HTTP
   * request is one limiter slot and retries a 429 via `send()`; any failing
   * chunk throws `IgdbError`.
   */
  async multiqueryGames(titles: readonly string[]): Promise<IgdbGame[][]> {
    if (titles.length === 0) return [];

    // Phase 1 — batched fuzzy search: ids only, IGDB search relevance order.
    // IGDB ignores `fields` for a sub-query that uses `search`, so we cannot
    // ask for hydration fields here (confirmed: Twitch/IGDB UserVoice bug and
    // Cookie285/game-collection#10, merged 2026-09-28); we only collect ids.
    const candidateIds: number[][] = [];
    for (
      let start = 0;
      start < titles.length;
      start += IGDB_MULTIQUERY_MAX_QUERIES
    ) {
      const chunk = titles.slice(start, start + IGDB_MULTIQUERY_MAX_QUERIES);
      const response = await this.authedRequest(
        IGDB_MULTIQUERY_URL,
        multiquerySearchBody(chunk),
      );
      const body = await this.json(response);
      candidateIds.push(...parseMultiqueryIds(body, chunk.length));
    }

    // Phase 2 — hydration: one batched /v4/games request per ≤500 unique ids.
    const uniqueIds = dedupeIds(candidateIds);
    const gamesById = new Map<number, IgdbGame>();
    for (
      let start = 0;
      start < uniqueIds.length;
      start += IGDB_HYDRATION_MAX_IDS
    ) {
      const ids = uniqueIds.slice(start, start + IGDB_HYDRATION_MAX_IDS);
      const response = await this.authedRequest(
        IGDB_GAMES_URL,
        hydrationBody(ids),
      );
      const body = await this.json(response);
      if (!Array.isArray(body)) {
        throw new IgdbError(false, 'IGDB returned an unexpected response');
      }
      for (const game of body.filter(isIgdbGame)) gamesById.set(game.id, game);
    }

    // Rebuild each title's candidates in the phase-1 id order; an id that
    // hydration did not return is dropped (never substitute a different game).
    const result = candidateIds.map((ids) =>
      ids
        .map((id) => gamesById.get(id))
        .filter((game): game is IgdbGame => game !== undefined),
    );
    result.forEach((games, index) => {
      this.logger.debug(
        JSON.stringify({
          event: 'igdb_multiquery',
          title: titles[index],
          results: games.map((game) => ({ id: game.id, name: game.name })),
        }),
      );
    });
    return result;
  }

  /**
   * Fetches the full canonical IGDB platform list in exactly one request
   * (ticket 4.2). Reuses the cached token and the central rate limiter, and
   * retries a 429 internally just like `searchGames`.
   */
  async fetchPlatforms(): Promise<IgdbPlatform[]> {
    const response = await this.authedRequest(
      IGDB_PLATFORMS_URL,
      IGDB_PLATFORMS_QUERY,
    );
    const body = await this.json(response);
    if (!Array.isArray(body)) {
      throw new IgdbError(false, 'IGDB returned an unexpected response');
    }
    return body.filter(isIgdbPlatform);
  }

  /**
   * Returns a valid cached token, or a single shared in-flight acquisition so
   * concurrent callers (e.g. the health probe and an import) trigger exactly
   * one token-endpoint request.
   */
  private getToken(): Promise<string> {
    if (this.token !== null && this.token.expiresAt > Date.now()) {
      return Promise.resolve(this.token.value);
    }
    if (this.tokenPromise !== null) {
      return this.tokenPromise;
    }
    this.tokenPromise = this.acquireToken().finally(() => {
      this.tokenPromise = null;
    });
    return this.tokenPromise;
  }

  private async acquireToken(): Promise<string> {
    const clientId = this.requiredEnv(IGDB_CLIENT_ID_ENV);
    const clientSecret = this.requiredEnv(IGDB_CLIENT_SECRET_ENV);
    const response = await this.send(
      () =>
        this.http.post({
          url: this.tokenUrl(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:
            `client_id=${encodeURIComponent(clientId)}` +
            `&client_secret=${encodeURIComponent(clientSecret)}` +
            '&grant_type=client_credentials',
          timeoutMs: IGDB_REQUEST_TIMEOUT_MS,
        }),
      // Twitch rejects bad credentials with 400 (`invalid client`), not just
      // 401/403, so a rejected client id/secret must be a config error.
      igdbTokenErrorFromStatus,
    );
    const body = await this.json(response);
    const data = isRecord(body) ? body : {};
    const value =
      typeof data.access_token === 'string'
        ? data.access_token
        : typeof data.token === 'string'
          ? data.token
          : null;
    if (value === null) {
      // A 2xx token response without a token means the configured token
      // endpoint (e.g. a proxy/mock) is misconfigured or misbehaving — a
      // config failure, not a permanent data error. Classifying it as config
      // surfaces 503 on search and a config-error pause on import instead of a
      // silent 200-empty search / unrecognized import.
      throw new IgdbConfigError('IGDB did not return an access token');
    }
    const expiresIn =
      typeof data.expires_in === 'number' && Number.isFinite(data.expires_in)
        ? data.expires_in
        : 3600;
    // Refresh one minute before expiry.
    this.token = {
      value,
      expiresAt: Date.now() + Math.max(0, expiresIn - 60) * 1000,
    };
    return value;
  }

  /**
   * Resolves a (cached) token per HTTP request and delegates to `request`, so
   * every request in a multi-chunk sequence uses a valid token.
   */
  private async authedRequest(
    url: string,
    body: string,
  ): Promise<IgdbHttpResponse> {
    const token = await this.getToken();
    return this.request(url, token, body);
  }

  private async request(
    url: string,
    token: string,
    body: string,
  ): Promise<IgdbHttpResponse> {
    const clientId = this.requiredEnv(IGDB_CLIENT_ID_ENV);
    return this.send(() =>
      this.http.post({
        url,
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        body,
        timeoutMs: IGDB_REQUEST_TIMEOUT_MS,
      }),
    );
  }

  private tokenUrl(): string {
    const override = this.config.get<string>(IGDB_TOKEN_URL_ENV);
    return override !== undefined && override.trim() !== ''
      ? override.trim()
      : IGDB_TOKEN_URL_DEFAULT;
  }

  /**
   * Sends one request through the central limiter, retrying a 429 up to
   * `IGDB_MAX_ATTEMPTS` times with bounded backoff. On exhaustion the
   * retryable `IgdbError` propagates so the worker's outer retry still applies.
   * `classify` maps a final non-2xx status to an error; token-endpoint callers
   * pass `igdbTokenErrorFromStatus` so rejected credentials become config
   * errors instead of permanent request errors.
   */
  private async send(
    makeRequest: () => Promise<IgdbHttpResponse>,
    classify: (status: number) => IgdbError = igdbErrorFromStatus,
  ): Promise<IgdbHttpResponse> {
    for (let attempt = 1; attempt <= IGDB_MAX_ATTEMPTS; attempt += 1) {
      let response: IgdbHttpResponse;
      try {
        response = await this.rateLimiter.schedule(makeRequest);
      } catch (error) {
        throw this.toIgdbError(error);
      }
      if (response.ok) return response;
      const error = classify(response.status);
      if (response.status !== 429 || attempt >= IGDB_MAX_ATTEMPTS) {
        throw error;
      }
      const delay = this.retryDelayMs(attempt, response);
      this.logger.debug(
        `IGDB rate-limited; retrying attempt ${String(attempt + 1)} in ${String(delay)}ms`,
      );
      await this.sleep(delay);
    }
    // Unreachable; the loop always returns or throws (kept for the type checker).
    throw new IgdbError(true, 'IGDB rate-limited the request');
  }

  private retryDelayMs(attempt: number, response: IgdbHttpResponse): number {
    const retryAfter = parseRetryAfter(
      response.headers?.get('retry-after') ?? null,
    );
    if (retryAfter !== null) {
      return Math.min(retryAfter, IGDB_RETRY_MAX_DELAY_MS);
    }
    const base = IGDB_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * IGDB_RETRY_JITTER_MS);
    return Math.min(base + jitter, IGDB_RETRY_MAX_DELAY_MS);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async json(response: IgdbHttpResponse): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new IgdbError(false, 'IGDB returned malformed JSON');
    }
  }

  /**
   * Connectivity/auth probe. Uses the cached token when valid (token: 'cached')
   * and otherwise acquires one ('acquired'); never throws and never leaks the
   * secret. Does NOT force a refresh just to test.
   */
  async checkHealth(): Promise<IgdbHealth> {
    const cached = this.token !== null && this.token.expiresAt > Date.now();
    try {
      await this.getToken();
      return { status: 'ok', token: cached ? 'cached' : 'acquired' };
    } catch (error) {
      return {
        status: 'error',
        token: 'error',
        message:
          error instanceof IgdbError
            ? error.message
            : 'IGDB status check failed',
      };
    }
  }

  /**
   * Best-effort token warm-up. Skipped under the test runner so no suite ever
   * reaches the network (even e2e booting `AppModule` with real credentials in
   * a developer `.env`), and skipped when credentials are absent. Never rejects.
   */
  private async warmUp(): Promise<void> {
    try {
      if (!this.isWarmUpEnabled()) return;
      const clientId = this.config.get<string>(IGDB_CLIENT_ID_ENV);
      const clientSecret = this.config.get<string>(IGDB_CLIENT_SECRET_ENV);
      if (
        clientId === undefined ||
        clientId.trim() === '' ||
        clientSecret === undefined ||
        clientSecret.trim() === ''
      ) {
        this.logger.log(
          'IGDB token warm-up skipped: credentials are not configured',
        );
        return;
      }
      await this.getToken();
      this.logger.log('IGDB token warmed up on bootstrap');
    } catch (error) {
      this.logger.warn(
        `IGDB token warm-up failed: ${
          error instanceof IgdbError
            ? error.message
            : 'IGDB could not be reached'
        }`,
      );
    }
  }

  private isWarmUpEnabled(): boolean {
    return process.env.NODE_ENV !== 'test';
  }

  private toIgdbError(error: unknown): IgdbError {
    if (error instanceof IgdbError) {
      return error;
    }
    return new IgdbError(true, 'IGDB could not be reached');
  }

  private requiredEnv(name: string): string {
    const value = this.config.get<string>(name);
    if (value === undefined || value.trim() === '') {
      throw new IgdbConfigError(`${name} is not configured`);
    }
    return value.trim();
  }
}

/** Escapes an APICalypse double-quoted search term and strips control chars. */
export function escapeApicalypse(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex -- deliberately strips C0/DEL controls
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
  );
}

/** One `query games "gN" { search …; fields id; limit …; };` block per title. */
function multiquerySearchBody(titles: readonly string[]): string {
  return titles
    .map(
      (title, index) =>
        `query games "g${String(index)}" {\n` +
        `search "${escapeApicalypse(title)}";\n` +
        `fields id;\n` +
        `limit ${String(IGDB_SEARCH_LIMIT)};\n` +
        '};',
    )
    .join('\n');
}

/** Hydration query: all catalog fields for a bounded set of ids. */
function hydrationBody(ids: readonly number[]): string {
  return (
    `fields ${IGDB_GAME_FIELDS}; ` +
    `where id = (${ids.join(',')}); ` +
    `limit ${String(IGDB_HYDRATION_MAX_IDS)};`
  );
}

/** Numeric ids from a `{ result: [{ id }] }` / legacy `[{ id }]` entry. */
function entryIds(entry: unknown): number[] {
  const rows = Array.isArray(entry)
    ? entry
    : isRecord(entry) && Array.isArray(entry.result)
      ? entry.result
      : [];
  return rows
    .map((row) => (isRecord(row) ? row.id : undefined))
    .filter((id): id is number => Number.isInteger(id) && (id as number) > 0);
}

/**
 * Maps a phase-1 multiquery response to one id list per sub-query, in input
 * order. Named responses (`gN`) are authoritative; positional fallback is used
 * ONLY when the whole response is the legacy unnamed array-of-arrays shape, so
 * a partially-named response can never shift ids onto the wrong title.
 */
function parseMultiqueryIds(body: unknown, count: number): number[][] {
  if (!Array.isArray(body)) {
    throw new IgdbError(false, 'IGDB returned an unexpected response');
  }
  const byName = new Map<string, number[]>();
  const positional: number[][] = [];
  let anyNamed = false;
  for (const entry of body) {
    const ids = entryIds(entry);
    positional.push(ids);
    if (isRecord(entry) && typeof entry.name === 'string') {
      byName.set(entry.name, ids);
      anyNamed = true;
    }
  }
  return Array.from({ length: count }, (_, index) =>
    anyNamed
      ? (byName.get(`g${String(index)}`) ?? [])
      : (positional[index] ?? []),
  );
}

/** Unique ids in first-seen order, across all titles. */
function dedupeIds(lists: readonly (readonly number[])[]): number[] {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const list of lists) {
    for (const id of list) {
      if (!seen.has(id)) {
        seen.add(id);
        unique.push(id);
      }
    }
  }
  return unique;
}

/** Parses an HTTP Retry-After header (seconds or HTTP-date); null if absent. */
export function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIgdbGame(value: unknown): value is IgdbGame {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.name === 'string'
  );
}

function isIgdbPlatform(value: unknown): value is IgdbPlatform {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.name === 'string'
  );
}
