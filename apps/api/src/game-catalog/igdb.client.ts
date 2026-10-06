import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IGDB_REQUEST_INTERVAL_MS,
  IGDB_REQUEST_TIMEOUT_MS,
} from '../import-jobs/import-pipeline.options';
import { IgdbError, igdbErrorFromStatus } from './igdb.errors';
import { IgdbHttpClient, type IgdbHttpResponse } from './igdb-http.client';

export const IGDB_CLIENT_ID_ENV = 'IGDB_CLIENT_ID';
export const IGDB_CLIENT_SECRET_ENV = 'IGDB_CLIENT_SECRET';

const IGDB_TOKEN_URL = 'https://api.igdb.com/v4/access_token';
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
export class IgdbClient {
  private readonly logger = new Logger(IgdbClient.name);
  private token: CachedToken | null = null;
  private lastRequestAt = 0;

  constructor(
    private readonly http: IgdbHttpClient,
    private readonly config: ConfigService,
  ) {}

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

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token !== null && this.token.expiresAt > now) {
      return this.token.value;
    }
    const clientId = this.requiredEnv(IGDB_CLIENT_ID_ENV);
    const clientSecret = this.requiredEnv(IGDB_CLIENT_SECRET_ENV);
    await this.throttle();
    let response: IgdbHttpResponse;
    try {
      response = await this.http.post({
        url: IGDB_TOKEN_URL,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:
          `client_id=${encodeURIComponent(clientId)}` +
          `&client_secret=${encodeURIComponent(clientSecret)}` +
          '&grant_type=client_credentials',
        timeoutMs: IGDB_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      throw this.toIgdbError(error);
    }
    if (!response.ok) {
      throw igdbErrorFromStatus(response.status);
    }
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
      expiresAt: now + Math.max(0, expiresIn - 60) * 1000,
    };
    return value;
  }

  private async request(
    url: string,
    token: string,
    body: string,
  ): Promise<IgdbHttpResponse> {
    await this.throttle();
    const clientId = this.requiredEnv(IGDB_CLIENT_ID_ENV);
    let response: IgdbHttpResponse;
    try {
      response = await this.http.post({
        url,
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        body,
        timeoutMs: IGDB_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      throw this.toIgdbError(error);
    }
    if (!response.ok) {
      throw igdbErrorFromStatus(response.status);
    }
    return response;
  }

  private async json(response: IgdbHttpResponse): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new IgdbError(false, 'IGDB returned malformed JSON');
    }
  }

  /** Serializes requests so a burst cannot trip IGDB's rate limit. */
  private async throttle(): Promise<void> {
    const waitMs = this.lastRequestAt + IGDB_REQUEST_INTERVAL_MS - Date.now();
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastRequestAt = Date.now();
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
