import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IGDB_REQUEST_TIMEOUT_MS } from '../import-jobs/import-pipeline.options';
import { IgdbError, igdbErrorFromStatus } from './igdb.errors';
import { IgdbHttpClient, type IgdbHttpResponse } from './igdb-http.client';
import { IgdbRateLimiter } from './igdb-rate-limiter';
import {
  IGDB_MAX_ATTEMPTS,
  IGDB_RETRY_BASE_DELAY_MS,
  IGDB_RETRY_JITTER_MS,
  IGDB_RETRY_MAX_DELAY_MS,
  IGDB_TOKEN_URL_DEFAULT,
  IGDB_TOKEN_URL_ENV,
} from './igdb.options';

export const IGDB_CLIENT_ID_ENV = 'IGDB_CLIENT_ID';
export const IGDB_CLIENT_SECRET_ENV = 'IGDB_CLIENT_SECRET';

const IGDB_GAMES_URL = 'https://api.igdb.com/v4/games';

/** Raw IGDB game shape (only the fields the query asks for). */
export interface IgdbGame {
  id: number;
  name: string;
  first_release_date?: number;
  cover?: { url?: string };
  involved_companies?: { company?: { name?: string } }[];
  genres?: { name?: string }[];
  platforms?: { id?: number; name?: string; abbreviation?: string }[];
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
    const token = await this.getToken();
    const query =
      `search "${escapeApicalypse(title)}"; ` +
      'fields name,first_release_date,cover.url,' +
      'involved_companies.company.name,genres.name,' +
      'platforms.id,platforms.name,platforms.abbreviation; ' +
      'limit 10;';
    const response = await this.request(IGDB_GAMES_URL, token, query);
    const body = await this.json(response);
    if (!Array.isArray(body)) {
      throw new IgdbError(false, 'IGDB returned an unexpected response');
    }
    return body.filter(isIgdbGame);
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
    const response = await this.send(() =>
      this.http.post({
        url: this.tokenUrl(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:
          `client_id=${encodeURIComponent(clientId)}` +
          `&client_secret=${encodeURIComponent(clientSecret)}` +
          '&grant_type=client_credentials',
        timeoutMs: IGDB_REQUEST_TIMEOUT_MS,
      }),
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
      throw new IgdbError(false, 'IGDB did not return an access token');
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
   * retryable `IgdbError` propagates so BullMQ's outer retry still applies.
   */
  private async send(
    makeRequest: () => Promise<IgdbHttpResponse>,
  ): Promise<IgdbHttpResponse> {
    for (let attempt = 1; attempt <= IGDB_MAX_ATTEMPTS; attempt += 1) {
      let response: IgdbHttpResponse;
      try {
        response = await this.rateLimiter.schedule(makeRequest);
      } catch (error) {
        throw this.toIgdbError(error);
      }
      if (response.ok) return response;
      const error = igdbErrorFromStatus(response.status);
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
      throw new IgdbError(false, `${name} is not configured`);
    }
    return value.trim();
  }
}

/** Escapes an APICalypse double-quoted search term. */
export function escapeApicalypse(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
