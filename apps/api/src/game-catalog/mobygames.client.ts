import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MobygamesError,
  MobygamesConfigError,
  mobygamesErrorFromStatus,
} from './mobygames.errors';
import {
  MobygamesHttpClient,
  type MobygamesHttpResponse,
  isAbortError,
} from './mobygames-http.client';
import {
  MOBYGAMES_API_KEY_ENV,
  MOBYGAMES_BASE_URL,
  MOBYGAMES_GAMES_PATH,
  MOBYGAMES_GAME_INCLUDE,
  MOBYGAMES_REQUEST_TIMEOUT_MS,
  MOBYGAMES_SEARCH_LIMIT,
} from './mobygames.options';
import { MobygamesRateLimiter } from './mobygames-rate-limiter';

export { MOBYGAMES_API_KEY_ENV } from './mobygames.options';

/** Raw MobyGames v2 shapes (only the fields the lookup asks for). */
export interface MobygameGenre {
  id?: number;
  name?: string;
}

export interface MobygameCompany {
  company_id?: number;
  company_name?: string;
  role?: string;
}

export interface MobygameRelease {
  release_date?: string;
  companies?: MobygameCompany[];
}

export interface MobygamePlatform {
  platform_id?: number;
  name?: string;
  release_date?: string;
  releases?: MobygameRelease[];
}

export interface MobygameCoverImage {
  image_url?: string;
  original_url?: string;
  thumbnail_url?: string;
}

export interface MobygameCover {
  images?: MobygameCoverImage[];
}

export interface MobygameGame {
  game_id: number;
  title: string;
  genres?: MobygameGenre[];
  platforms?: MobygamePlatform[];
  covers?: MobygameCover[];
}

/** The configured MobyGames API key, or `null` when unset/blank. */
export function mobygamesApiKey(config: ConfigService): string | null {
  const value = config.get<string>(MOBYGAMES_API_KEY_ENV);
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** True only when a usable MobyGames API key is configured. */
export function isMobygamesConfigured(config: ConfigService): boolean {
  return mobygamesApiKey(config) !== null;
}

/**
 * Minimal MobyGames v2 client: one `/v2/games` title search, routed through the
 * central `MobygamesRateLimiter` (1 req/s, 720 req/h). There is deliberately no
 * internal 429 retry: the budget is enforced client-side, so a 429 becomes a
 * retryable `MobygamesError` that BullMQ retries — a request is never fired and
 * then retried on 429. The API key (a query parameter) is never included in an
 * error message.
 */
@Injectable()
export class MobygamesClient {
  constructor(
    private readonly http: MobygamesHttpClient,
    private readonly config: ConfigService,
    private readonly rateLimiter: MobygamesRateLimiter,
  ) {}

  async searchGames(title: string): Promise<MobygameGame[]> {
    const url = this.searchUrl(title);
    const response = await this.rateLimiter.schedule(() =>
      this.http.get({ url, timeoutMs: MOBYGAMES_REQUEST_TIMEOUT_MS }),
    );
    if (!response.ok) {
      throw mobygamesErrorFromStatus(response.status);
    }
    const body = await this.json(response);
    if (!isRecord(body) || !Array.isArray(body.games)) {
      throw new MobygamesError(
        false,
        'MobyGames returned an unexpected response',
      );
    }
    return body.games.filter(isMobygameGame);
  }

  private searchUrl(title: string): string {
    const apiKey = mobygamesApiKey(this.config);
    if (apiKey === null) {
      throw new MobygamesConfigError(
        `${MOBYGAMES_API_KEY_ENV} is not configured`,
      );
    }
    const params = new URLSearchParams({
      title,
      fuzzy: 'true',
      limit: String(MOBYGAMES_SEARCH_LIMIT),
      include: MOBYGAMES_GAME_INCLUDE,
      api_key: apiKey,
    });
    return `${MOBYGAMES_BASE_URL}${MOBYGAMES_GAMES_PATH}?${params.toString()}`;
  }

  private async json(response: MobygamesHttpResponse): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      // A timeout/abort that lands during the body read is transient, not a
      // malformed body; only a genuine parse failure is permanent.
      if (isAbortError(error)) {
        throw new MobygamesError(true, 'MobyGames did not respond in time');
      }
      throw new MobygamesError(false, 'MobyGames returned malformed JSON');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMobygameGame(value: unknown): value is MobygameGame {
  return (
    isRecord(value) &&
    typeof value.game_id === 'number' &&
    typeof value.title === 'string'
  );
}
