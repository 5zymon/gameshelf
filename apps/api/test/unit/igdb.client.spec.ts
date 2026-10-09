import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  escapeApicalypse,
  IgdbClient,
  IGDB_CLIENT_ID_ENV,
  IGDB_CLIENT_SECRET_ENV,
  parseRetryAfter,
} from '../../src/game-catalog/igdb.client';
import { IgdbConfigError, IgdbError } from '../../src/game-catalog/igdb.errors';
import { IgdbGameCatalogResolver } from '../../src/game-catalog/igdb-game-catalog.resolver';
import {
  IGDB_MAX_ATTEMPTS,
  IGDB_TOKEN_URL_DEFAULT,
  IGDB_TOKEN_URL_ENV,
} from '../../src/game-catalog/igdb.options';
import { IgdbRateLimiter } from '../../src/game-catalog/igdb-rate-limiter';
import {
  FetchIgdbHttpClient,
  IgdbHttpClient,
  type IgdbHttpRequest,
  type IgdbHttpResponse,
} from '../../src/game-catalog/igdb-http.client';

const TOKEN_URL = IGDB_TOKEN_URL_DEFAULT;
const GAMES_URL = 'https://api.igdb.com/v4/games';
const MULTIQUERY_URL = 'https://api.igdb.com/v4/multiquery';
const PLATFORMS_URL = 'https://api.igdb.com/v4/platforms';

/**
 * Loads a recorded IGDB response envelope from `test/fixtures/igdb`.
 * `search-halo-response.json` is a full `/v4/games` array wrapping the same
 * sanitised payload as `igdb/halo-game.json`; `multiquery-halo-response.json`
 * and `platforms-response.json` are the recorded multiquery/platforms bodies.
 */
function igdbFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'igdb', name), 'utf8'),
  ) as unknown;
}

/** Number of `query games "gN"` sub-queries in a multiquery request body. */
function countSubQueries(body: string): number {
  return (body.match(/query games "/g) ?? []).length;
}

function headers(map: Record<string, string>): {
  get(name: string): string | null;
} {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    lower[key.toLowerCase()] = value;
  }
  return {
    get: (name: string): string | null => lower[name.toLowerCase()] ?? null,
  };
}

function httpResponse(
  status: number,
  body: unknown,
  responseHeaders?: { get(name: string): string | null },
): IgdbHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    ...(responseHeaders ? { headers: responseHeaders } : {}),
    json: () => Promise.resolve(body),
    text: () =>
      Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** A limiter with effectively no caps, so tests observe the client only. */
function permissiveLimiter(): IgdbRateLimiter {
  return new IgdbRateLimiter({
    maxRequestsPerSecond: Number.MAX_SAFE_INTEGER,
    maxConcurrent: Number.MAX_SAFE_INTEGER,
    windowMs: 1000,
  });
}

/** Lets queued microtasks (token acquisition, scheduling) settle. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

/** Records every request and delegates to a per-test handler. */
class FakeHttpClient extends IgdbHttpClient {
  readonly requests: IgdbHttpRequest[] = [];

  constructor(
    private readonly handler: (
      request: IgdbHttpRequest,
    ) => Promise<IgdbHttpResponse>,
  ) {
    super();
  }

  post(request: IgdbHttpRequest): Promise<IgdbHttpResponse> {
    this.requests.push(request);
    return this.handler(request);
  }
}

function config(
  overrides: Record<string, string | undefined> = {},
): ConfigService {
  const values: Record<string, string | undefined> = {
    [IGDB_CLIENT_ID_ENV]: 'client-id',
    [IGDB_CLIENT_SECRET_ENV]: 'client-secret',
    ...overrides,
  };
  return {
    get: (name: string): string | undefined => values[name],
  } as unknown as ConfigService;
}

/** A handler that answers the token endpoint and delegates games requests. */
function clientWith(
  gamesHandler: (request: IgdbHttpRequest) => Promise<IgdbHttpResponse>,
): { client: IgdbClient; http: FakeHttpClient } {
  const http = new FakeHttpClient((request) =>
    request.url === TOKEN_URL
      ? Promise.resolve(
          httpResponse(200, { access_token: 'token-1', expires_in: 3600 }),
        )
      : gamesHandler(request),
  );
  return { client: new IgdbClient(http, config(), permissiveLimiter()), http };
}

/** Routes a fake non-token handler by request URL; unknown URLs get an empty 200. */
function byUrl(
  routes: Record<
    string,
    (request: IgdbHttpRequest) => Promise<IgdbHttpResponse>
  >,
): (request: IgdbHttpRequest) => Promise<IgdbHttpResponse> {
  return (request) => {
    const route = routes[request.url];
    return route ? route(request) : Promise.resolve(httpResponse(200, []));
  };
}

/** The `where id = (…)` id list from a hydration request body. */
function hydrationIds(body: string): number[] {
  const ids = /where id = \(([^)]*)\)/.exec(body)?.[1];
  if (ids === undefined || ids === '') return [];
  return ids.split(',').map((raw) => Number(raw));
}

describe('escapeApicalypse (unit)', () => {
  it('escapes a double quote used in a title', () => {
    expect(escapeApicalypse('a"b')).toBe('a\\"b');
  });

  it('escapes a backslash used in a title', () => {
    expect(escapeApicalypse('a\\b')).toBe('a\\\\b');
  });

  it('escapes a backslash followed by a quote', () => {
    expect(escapeApicalypse('a\\"b')).toBe('a\\\\\\"b');
  });

  it('leaves an ordinary title untouched', () => {
    expect(escapeApicalypse('Halo: Combat Evolved')).toBe(
      'Halo: Combat Evolved',
    );
  });

  it('strips newline and carriage-return control characters', () => {
    expect(escapeApicalypse('a\nb\rc')).toBe('a b c');
  });

  it('strips a NUL control character and leaves no C0/C1 controls', () => {
    const escaped = escapeApicalypse('Halo\u00002');
    expect(escaped).toBe('Halo 2');
    // eslint-disable-next-line no-control-regex -- asserts no C0/DEL controls remain
    expect(escaped).toMatch(/^[^\u0000-\u001F\u007F]*$/u);
  });
});

describe('parseRetryAfter (unit)', () => {
  it('parses a delay in seconds to milliseconds', () => {
    expect(parseRetryAfter('2')).toBe(2000);
  });

  it('returns null when the header is absent', () => {
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('returns null for an empty header', () => {
    expect(parseRetryAfter('')).toBeNull();
  });

  it('returns null for unparseable text', () => {
    expect(parseRetryAfter('nonsense')).toBeNull();
  });

  it('parses an HTTP-date and clamps a past date to zero', () => {
    const past = new Date(Date.now() - 10_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });

  it('parses a future HTTP-date as a positive delay', () => {
    const future = new Date(Date.now() + 30_000).toUTCString();

    const delay = parseRetryAfter(future);

    if (delay === null) {
      throw new Error('expected a delay for a future HTTP-date');
    }
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(30_000);
  });
});

describe('IgdbClient (unit)', () => {
  let delays: number[] = [];

  beforeEach(() => {
    // Instant, recording timers keep the retry-backoff assertions deterministic
    // and the suite fast. The HTTP seam is fully faked, so nothing else waits.
    delays = [];
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: (...args: unknown[]) => void,
      ms?: number,
    ) => {
      delays.push(ms ?? 0);
      callback();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('escapes the model-provided title so it cannot break out of the search term', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    await client.searchGames('Halo"; fields name; limit 1; //');

    const gamesRequest = http.requests.find(
      (request) => request.url === GAMES_URL,
    );
    expect(gamesRequest?.body).toContain(
      'search "Halo\\"; fields name; limit 1; //";',
    );
  });

  it('requests exactly the catalog fields (no wildcard, no alternative_names)', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    await client.searchGames('Halo');

    const gamesRequest = http.requests.find(
      (request) => request.url === GAMES_URL,
    );
    expect(gamesRequest?.body).toBe(
      'search "Halo"; fields name,first_release_date,cover.url,' +
        'involved_companies.company.name,genres.name,platforms.id,' +
        'platforms.name,platforms.abbreviation,summary,version_parent,' +
        'multiplayer_modes.offlinemax,multiplayer_modes.onlinemax,' +
        'multiplayer_modes.offlinecoopmax,multiplayer_modes.onlinecoopmax,' +
        'screenshots.url,artworks.url; limit 10;',
    );
    expect(gamesRequest?.body).not.toContain('fields *');
    expect(gamesRequest?.body).not.toContain('alternative_names');
  });

  it('caches the OAuth token across calls until it expires', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    await client.searchGames('Halo');
    await client.searchGames('Halo 2');

    expect(http.requests.filter((r) => r.url === TOKEN_URL)).toHaveLength(1);
    const games = http.requests.filter((r) => r.url === GAMES_URL);
    expect(games).toHaveLength(2);
    expect(games[0]?.headers.Authorization).toBe('Bearer token-1');
    expect(games[0]?.headers['Client-ID']).toBe('client-id');
  });

  it('acquires a single token for concurrent callers', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    const [first, second] = await Promise.all([
      client.checkHealth(),
      client.checkHealth(),
    ]);

    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    expect(http.requests.filter((r) => r.url === TOKEN_URL)).toHaveLength(1);
  });

  it('refreshes the token once expires_in has elapsed', async () => {
    let now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    let tokenCount = 0;
    const http = new FakeHttpClient((request) => {
      if (request.url === TOKEN_URL) {
        tokenCount += 1;
        return Promise.resolve(
          httpResponse(200, {
            access_token: `token-${String(tokenCount)}`,
            expires_in: 100,
          }),
        );
      }
      return Promise.resolve(httpResponse(200, []));
    });
    const client = new IgdbClient(http, config(), permissiveLimiter());

    await client.searchGames('Halo');
    expect(tokenCount).toBe(1);

    // expiresAt = now + (100 - 60)s; step past it.
    now += 41_000;
    await client.searchGames('Halo 2');
    expect(tokenCount).toBe(2);
    nowSpy.mockRestore();
  });

  it('uses the canonical Twitch token endpoint by default', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    await client.searchGames('Halo');

    expect(TOKEN_URL).toBe('https://id.twitch.tv/oauth2/token');
    expect(http.requests[0]?.url).toBe(TOKEN_URL);
  });

  it('honors the IGDB_TOKEN_URL env override', async () => {
    const override = 'https://override.test/token';
    const http = new FakeHttpClient((request) => {
      if (request.url === override) {
        return Promise.resolve(
          httpResponse(200, { access_token: 'token-1', expires_in: 3600 }),
        );
      }
      return Promise.resolve(httpResponse(200, []));
    });
    const client = new IgdbClient(
      http,
      config({ [IGDB_TOKEN_URL_ENV]: override }),
      permissiveLimiter(),
    );

    await client.searchGames('Halo');

    expect(http.requests[0]?.url).toBe(override);
  });

  it('routes every request through the injected rate limiter', async () => {
    const limiter = permissiveLimiter();
    const scheduleSpy = jest.spyOn(limiter, 'schedule');
    const http = new FakeHttpClient((request) =>
      request.url === TOKEN_URL
        ? Promise.resolve(
            httpResponse(200, { access_token: 'token-1', expires_in: 3600 }),
          )
        : Promise.resolve(httpResponse(200, [])),
    );
    const client = new IgdbClient(http, config(), limiter);

    await client.searchGames('Halo');

    // Token acquisition + games lookup.
    expect(scheduleSpy).toHaveBeenCalledTimes(2);
  });

  it('retries a 429 with exponential backoff and then succeeds', async () => {
    let calls = 0;
    const { client } = clientWith(() => {
      calls += 1;
      return Promise.resolve(
        calls <= 2
          ? httpResponse(429, { message: 'too many requests' })
          : httpResponse(200, [{ id: 1, name: 'Halo' }]),
      );
    });

    const games = await client.searchGames('Halo');

    expect(games).toHaveLength(1);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(500);
    expect(delays[0]).toBeLessThanOrEqual(750);
    expect(delays[1]).toBeGreaterThanOrEqual(1000);
    expect(delays[1]).toBeLessThanOrEqual(1250);
  });

  it('honors a Retry-After header on a 429', async () => {
    let calls = 0;
    const { client } = clientWith(() => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? httpResponse(429, {}, headers({ 'Retry-After': '2' }))
          : httpResponse(200, []),
      );
    });

    await client.searchGames('Halo');

    expect(delays).toEqual([2000]);
  });

  it('gives up after IGDB_MAX_ATTEMPTS and throws a retryable error', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(429, { message: 'too many requests' })),
    );

    const error = await client.searchGames('Halo').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(true);
    expect(http.requests.filter((r) => r.url === GAMES_URL)).toHaveLength(
      IGDB_MAX_ATTEMPTS,
    );
    expect(delays).toHaveLength(IGDB_MAX_ATTEMPTS - 1);
  });

  it('sends no request when credentials are missing', async () => {
    const http = new FakeHttpClient(() =>
      Promise.resolve(httpResponse(200, [])),
    );
    const client = new IgdbClient(
      http,
      config({ [IGDB_CLIENT_ID_ENV]: undefined }),
      permissiveLimiter(),
    );

    const error = await client.searchGames('Halo').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(false);
    expect(http.requests).toHaveLength(0);
  });

  it('maps a permanent credential error without leaking the secret', async () => {
    const http = new FakeHttpClient(() =>
      Promise.resolve(httpResponse(401, { message: 'Unauthorized' })),
    );
    const client = new IgdbClient(
      http,
      config({ [IGDB_CLIENT_SECRET_ENV]: 'super-secret' }),
      permissiveLimiter(),
    );

    const error = await client.searchGames('Halo').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(false);
    expect((error as IgdbError).message).not.toContain('super-secret');
    expect((error as IgdbError).message).not.toContain('client-secret');
  });

  it('maps a 5xx on the games endpoint to a retryable error', async () => {
    const { client } = clientWith(() =>
      Promise.resolve(httpResponse(503, { message: 'unavailable' })),
    );

    const error = await client.searchGames('Halo').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(true);
  });

  it('wraps a transport failure as a retryable error', async () => {
    const { client } = clientWith(() =>
      Promise.reject(new Error('ECONNRESET')),
    );

    const error = await client.searchGames('Halo').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(true);
    expect((error as IgdbError).message).toBe('IGDB could not be reached');
  });

  it('reports malformed JSON as a permanent error', async () => {
    const { client } = clientWith(() =>
      Promise.resolve({
        status: 200,
        ok: true,
        json: () => Promise.reject(new Error('bad json')),
        text: () => Promise.resolve('not json'),
      }),
    );

    const error = await client.searchGames('Halo').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(false);
    expect((error as IgdbError).message).toBe('IGDB returned malformed JSON');
  });

  it('reports a cached token from checkHealth without a second call', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );
    await client.searchGames('Halo');

    const health = await client.checkHealth();

    expect(health).toEqual({ status: 'ok', token: 'cached' });
    expect(http.requests.filter((r) => r.url === TOKEN_URL)).toHaveLength(1);
  });

  it('acquires a token from checkHealth when none is cached', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    const health = await client.checkHealth();

    expect(health).toEqual({ status: 'ok', token: 'acquired' });
    expect(http.requests.filter((r) => r.url === TOKEN_URL)).toHaveLength(1);
  });

  it('reports an error health status without throwing', async () => {
    const http = new FakeHttpClient(() =>
      Promise.resolve(httpResponse(200, [])),
    );
    const client = new IgdbClient(
      http,
      config({ [IGDB_CLIENT_ID_ENV]: undefined }),
      permissiveLimiter(),
    );

    const health = await client.checkHealth();

    expect(health.status).toBe('error');
    expect(health.token).toBe('error');
    expect(health.message).toContain('IGDB_CLIENT_ID');
  });
});

describe('IgdbClient token-endpoint classification (unit)', () => {
  beforeEach(() => {
    // Instant retries keep the 429 exhaustion test deterministic and fast.
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: (...args: unknown[]) => void,
    ) => {
      callback();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** A client whose token endpoint is driven by `tokenResponse`. */
  function clientWithTokenResponse(
    tokenResponse: () => Promise<IgdbHttpResponse>,
  ): { client: IgdbClient; http: FakeHttpClient } {
    const http = new FakeHttpClient((request) =>
      request.url === TOKEN_URL
        ? tokenResponse()
        : Promise.resolve(httpResponse(200, [])),
    );
    return {
      client: new IgdbClient(http, config(), permissiveLimiter()),
      http,
    };
  }

  it('treats a token-endpoint HTTP 400 invalid client as a config error', async () => {
    const { client, http } = clientWithTokenResponse(() =>
      Promise.resolve(
        httpResponse(400, { status: 400, message: 'invalid client' }),
      ),
    );

    const error = await client.searchGames('halo').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbConfigError);
    expect((error as IgdbError).retryable).toBe(false);
    // Rejected at token acquisition; no games request is ever sent.
    expect(http.requests.filter((r) => r.url === GAMES_URL)).toHaveLength(0);
  });

  it.each([401, 403])(
    'treats a token-endpoint HTTP %i as a config error',
    async (status) => {
      const { client } = clientWithTokenResponse(() =>
        Promise.resolve(httpResponse(status, { message: 'rejected' })),
      );

      const error = await client.searchGames('halo').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(IgdbConfigError);
      expect((error as IgdbError).retryable).toBe(false);
    },
  );

  it.each([500, 503])(
    'keeps a token-endpoint HTTP %i retryable/transient',
    async (status) => {
      const { client } = clientWithTokenResponse(() =>
        Promise.resolve(httpResponse(status, { message: 'unavailable' })),
      );

      const error = await client.searchGames('halo').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(IgdbError);
      expect(error).not.toBeInstanceOf(IgdbConfigError);
      expect((error as IgdbError).retryable).toBe(true);
    },
  );

  it('keeps a token-endpoint 429 retryable after exhausting attempts', async () => {
    const { client, http } = clientWithTokenResponse(() =>
      Promise.resolve(httpResponse(429, { message: 'too many requests' })),
    );

    const error = await client.searchGames('halo').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect(error).not.toBeInstanceOf(IgdbConfigError);
    expect((error as IgdbError).retryable).toBe(true);
    expect(http.requests.filter((r) => r.url === TOKEN_URL)).toHaveLength(
      IGDB_MAX_ATTEMPTS,
    );
  });

  it('keeps a token-endpoint network failure retryable/transient', async () => {
    const { client } = clientWithTokenResponse(() =>
      Promise.reject(new Error('ECONNRESET')),
    );

    const error = await client.searchGames('halo').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect(error).not.toBeInstanceOf(IgdbConfigError);
    expect((error as IgdbError).retryable).toBe(true);
    expect((error as IgdbError).message).toBe('IGDB could not be reached');
  });

  it('maps a token 400 config error to a resolver config_error (-> 503)', async () => {
    const { client } = clientWithTokenResponse(() =>
      Promise.resolve(
        httpResponse(400, { status: 400, message: 'invalid client' }),
      ),
    );
    const resolver = new IgdbGameCatalogResolver(client);

    const result = await resolver.search('halo');

    expect(result.kind).toBe('config_error');
    if (result.kind !== 'config_error') return;
    expect(result.source).toBe('igdb');
    expect(result.reason).toContain('IGDB token endpoint rejected the request');
  });

  it('treats a 2xx token response without an access token as a config error', async () => {
    const { client, http } = clientWithTokenResponse(() =>
      Promise.resolve(httpResponse(200, {})),
    );

    const error = await client.searchGames('halo').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbConfigError);
    expect((error as IgdbError).retryable).toBe(false);
    // Misconfigured token endpoint (2xx, no token): fail at token
    // acquisition, so no games request is ever sent and no secret leaks.
    expect(http.requests.filter((r) => r.url === GAMES_URL)).toHaveLength(0);
    expect((error as IgdbError).message).toBe(
      'IGDB did not return an access token',
    );
    expect((error as IgdbError).message).not.toContain('client-secret');
    expect((error as IgdbError).message).not.toContain('client_secret');
    expect((error as IgdbError).message).not.toContain('Bearer');
  });

  it('maps a 2xx token response without an access token to a config_error (-> 503)', async () => {
    const { client } = clientWithTokenResponse(() =>
      Promise.resolve(httpResponse(200, {})),
    );
    const resolver = new IgdbGameCatalogResolver(client);

    const result = await resolver.search('halo');

    expect(result.kind).toBe('config_error');
    if (result.kind !== 'config_error') return;
    expect(result.source).toBe('igdb');
    expect(result.reason).toBe('IGDB did not return an access token');
  });
});

describe('IgdbClient.multiqueryGames (unit)', () => {
  let delays: number[] = [];

  beforeEach(() => {
    delays = [];
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: (...args: unknown[]) => void,
      ms?: number,
    ) => {
      delays.push(ms ?? 0);
      callback();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends no request and returns [] for zero titles', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    await expect(client.multiqueryGames([])).resolves.toEqual([]);
    expect(http.requests).toHaveLength(0);
  });

  it('packs 2 titles into one multiquery request with ids-only fields', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    await client.multiqueryGames(['Halo', 'Doom']);

    const requests = http.requests.filter((r) => r.url === MULTIQUERY_URL);
    expect(requests).toHaveLength(1);
    expect(countSubQueries(requests[0]?.body ?? '')).toBe(2);
    expect(requests[0]?.body).toContain('query games "g0" {');
    expect(requests[0]?.body).toContain('query games "g1" {');
    expect(requests[0]?.body).toContain('search "Halo"');
    expect(requests[0]?.body).toContain('search "Doom"');
    expect(requests[0]?.body).toContain('fields id;');
    expect(http.requests.some((r) => r.url === GAMES_URL)).toBe(false);
  });

  it('packs 10 titles into one multiquery request', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    await client.multiqueryGames(
      Array.from({ length: 10 }, (_, i) => `T${String(i)}`),
    );

    const requests = http.requests.filter((r) => r.url === MULTIQUERY_URL);
    expect(requests).toHaveLength(1);
    expect(countSubQueries(requests[0]?.body ?? '')).toBe(10);
    for (let i = 0; i < 10; i += 1) {
      expect(requests[0]?.body).toContain(`query games "g${String(i)}" {`);
    }
  });

  it('splits 11 titles into requests of 10 and 1 (no hydration without ids)', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    await client.multiqueryGames(
      Array.from({ length: 11 }, (_, i) => `T${String(i)}`),
    );

    const requests = http.requests.filter((r) => r.url === MULTIQUERY_URL);
    expect(requests).toHaveLength(2);
    expect(countSubQueries(requests[0]?.body ?? '')).toBe(10);
    expect(countSubQueries(requests[1]?.body ?? '')).toBe(1);
    expect(http.requests.some((r) => r.url === GAMES_URL)).toBe(false);
  });

  it('attributes results by sub-query name, not response order', async () => {
    const { client } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: () =>
          Promise.resolve(
            httpResponse(200, [
              { name: 'g1', result: [{ id: 2 }] },
              { name: 'g0', result: [{ id: 1 }] },
              { name: 'g2' },
            ]),
          ),
        [GAMES_URL]: () =>
          Promise.resolve(
            httpResponse(200, [
              { id: 1, name: 'Halo' },
              { id: 2, name: 'Doom' },
            ]),
          ),
      }),
    );

    const results = await client.multiqueryGames(['Halo', 'Doom', 'Unknown']);

    expect(results).toEqual([
      [{ id: 1, name: 'Halo' }],
      [{ id: 2, name: 'Doom' }],
      [],
    ]);
  });

  it('ignores an unnamed entry in a mixed named/positional response (M1)', async () => {
    const { client } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: () =>
          Promise.resolve(
            httpResponse(200, [
              { name: 'g0', result: [{ id: 1 }] },
              [{ id: 2 }],
            ]),
          ),
        [GAMES_URL]: () =>
          Promise.resolve(
            httpResponse(200, [
              { id: 1, name: 'Halo' },
              { id: 2, name: 'Doom' },
            ]),
          ),
      }),
    );

    const results = await client.multiqueryGames(['Halo', 'Doom']);

    // The unnamed array entry must NOT be attributed to g1 by position.
    expect(results).toEqual([[{ id: 1, name: 'Halo' }], []]);
  });

  it('treats an omitted named sub-query (g0) as an empty candidate list (M1)', async () => {
    const { client } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: () =>
          Promise.resolve(
            httpResponse(200, [{ name: 'g1', result: [{ id: 2 }] }]),
          ),
        [GAMES_URL]: () =>
          Promise.resolve(httpResponse(200, [{ id: 2, name: 'Doom' }])),
      }),
    );

    await expect(client.multiqueryGames(['Halo', 'Doom'])).resolves.toEqual([
      [],
      [{ id: 2, name: 'Doom' }],
    ]);
  });

  it('maps the legacy wholly-unnamed array-of-arrays response positionally', async () => {
    const { client } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: () =>
          Promise.resolve(httpResponse(200, [[{ id: 1 }], [{ id: 2 }]])),
        [GAMES_URL]: () =>
          Promise.resolve(
            httpResponse(200, [
              { id: 1, name: 'Halo' },
              { id: 2, name: 'Doom' },
            ]),
          ),
      }),
    );

    await expect(client.multiqueryGames(['Halo', 'Doom'])).resolves.toEqual([
      [{ id: 1, name: 'Halo' }],
      [{ id: 2, name: 'Doom' }],
    ]);
  });

  it('requests only ids in phase 1 and the full catalog fields in hydration', async () => {
    const { client, http } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: () =>
          Promise.resolve(
            httpResponse(200, [{ name: 'g0', result: [{ id: 5 }] }]),
          ),
        [GAMES_URL]: () =>
          Promise.resolve(httpResponse(200, [{ id: 5, name: 'Halo' }])),
      }),
    );

    await client.multiqueryGames(['Halo']);

    const multiBody =
      http.requests.find((r) => r.url === MULTIQUERY_URL)?.body ?? '';
    expect(multiBody).toContain('fields id;');
    expect(multiBody).not.toContain('cover.url');
    expect(multiBody).not.toContain('screenshots.url');
    expect(multiBody).not.toContain('alternative_names');

    const gamesBody =
      http.requests.find((r) => r.url === GAMES_URL)?.body ?? '';
    expect(gamesBody).toBe(
      'fields name,first_release_date,cover.url,' +
        'involved_companies.company.name,genres.name,platforms.id,' +
        'platforms.name,platforms.abbreviation,summary,version_parent,' +
        'multiplayer_modes.offlinemax,multiplayer_modes.onlinemax,' +
        'multiplayer_modes.offlinecoopmax,multiplayer_modes.onlinecoopmax,' +
        'screenshots.url,artworks.url; ' +
        'where id = (5); limit 500;',
    );
    expect(gamesBody).not.toContain('fields *');
    expect(gamesBody).not.toContain('alternative_names');
  });

  it('drops a phase-1 id that hydration does not return', async () => {
    const { client } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: () =>
          Promise.resolve(
            httpResponse(200, [{ name: 'g0', result: [{ id: 1 }, { id: 2 }] }]),
          ),
        [GAMES_URL]: () =>
          Promise.resolve(httpResponse(200, [{ id: 2, name: 'D' }])),
      }),
    );

    await expect(client.multiqueryGames(['Halo'])).resolves.toEqual([
      [{ id: 2, name: 'D' }],
    ]);
  });

  it('dedupes a shared id into one hydration request and attributes it to both titles', async () => {
    const { client, http } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: () =>
          Promise.resolve(
            httpResponse(200, [
              { name: 'g0', result: [{ id: 7 }] },
              { name: 'g1', result: [{ id: 7 }] },
            ]),
          ),
        [GAMES_URL]: () =>
          Promise.resolve(httpResponse(200, [{ id: 7, name: 'Shared' }])),
      }),
    );

    const results = await client.multiqueryGames(['A', 'B']);

    const gamesRequests = http.requests.filter((r) => r.url === GAMES_URL);
    expect(gamesRequests).toHaveLength(1);
    expect(gamesRequests[0]?.body).toContain('where id = (7)');
    expect(results).toEqual([
      [{ id: 7, name: 'Shared' }],
      [{ id: 7, name: 'Shared' }],
    ]);
  });

  it('throws a permanent IgdbError when the hydration body is not an array', async () => {
    const { client } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: () =>
          Promise.resolve(
            httpResponse(200, [{ name: 'g0', result: [{ id: 5 }] }]),
          ),
        [GAMES_URL]: () =>
          Promise.resolve(httpResponse(200, { message: 'nope' })),
      }),
    );

    const error = await client
      .multiqueryGames(['Halo'])
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(false);
    expect((error as IgdbError).message).toBe(
      'IGDB returned an unexpected response',
    );
  });

  it('returns 11 titles across 2 chunks as 11 arrays in input order (m2)', async () => {
    const { client, http } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: (request) =>
          request.body.includes('search "T0"')
            ? Promise.resolve(
                httpResponse(
                  200,
                  Array.from({ length: 10 }, (_, i) => ({
                    name: `g${String(i)}`,
                    result: [{ id: i + 1 }],
                  })),
                ),
              )
            : Promise.resolve(
                httpResponse(200, [{ name: 'g0', result: [{ id: 11 }] }]),
              ),
        [GAMES_URL]: (request) =>
          Promise.resolve(
            httpResponse(
              200,
              hydrationIds(request.body).map((id) => ({
                id,
                name: `Game ${String(id)}`,
              })),
            ),
          ),
      }),
    );

    const results = await client.multiqueryGames(
      Array.from({ length: 11 }, (_, i) => `T${String(i)}`),
    );

    expect(http.requests.filter((r) => r.url === MULTIQUERY_URL)).toHaveLength(
      2,
    );
    expect(results).toHaveLength(11);
    for (let i = 0; i < 11; i += 1) {
      expect(results[i]).toEqual([
        { id: i + 1, name: `Game ${String(i + 1)}` },
      ]);
    }
    const gamesRequest = http.requests.find((r) => r.url === GAMES_URL);
    expect(hydrationIds(gamesRequest?.body ?? '')).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('dedupes an id shared across chunks into one hydration request (m2)', async () => {
    const { client, http } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: (request) =>
          request.body.includes('search "T0"')
            ? Promise.resolve(
                httpResponse(200, [
                  { name: 'g0', result: [{ id: 3 }] },
                  ...Array.from({ length: 9 }, (_, i) => ({
                    name: `g${String(i + 1)}`,
                  })),
                ]),
              )
            : Promise.resolve(
                httpResponse(200, [{ name: 'g0', result: [{ id: 3 }] }]),
              ),
        [GAMES_URL]: () =>
          Promise.resolve(httpResponse(200, [{ id: 3, name: 'Shared' }])),
      }),
    );

    const results = await client.multiqueryGames(
      Array.from({ length: 11 }, (_, i) => `T${String(i)}`),
    );

    expect(http.requests.filter((r) => r.url === GAMES_URL)).toHaveLength(1);
    expect(results[0]).toEqual([{ id: 3, name: 'Shared' }]);
    expect(results[10]).toEqual([{ id: 3, name: 'Shared' }]);
    for (let i = 1; i <= 9; i += 1) {
      expect(results[i]).toEqual([]);
    }
  });

  it('splits hydration at the 500-id cap and rebuilds titles in order', async () => {
    const titleCount = 51;
    const idsPerTitle = 10;
    const idsForTitle = (index: number): number[] =>
      Array.from(
        { length: idsPerTitle },
        (_, offset) => index * idsPerTitle + offset + 1,
      );

    const { client, http } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: (request) => {
          const titleIndexes = [
            ...request.body.matchAll(/search "T(\d+)";/g),
          ].map((match) => Number(match[1]));
          return Promise.resolve(
            httpResponse(
              200,
              titleIndexes.map((titleIndex, subIndex) => ({
                name: `g${String(subIndex)}`,
                result: idsForTitle(titleIndex).map((id) => ({ id })),
              })),
            ),
          );
        },
        [GAMES_URL]: (request) =>
          Promise.resolve(
            httpResponse(
              200,
              hydrationIds(request.body).map((id) => ({
                id,
                name: `Game ${String(id)}`,
              })),
            ),
          ),
      }),
    );

    const results = await client.multiqueryGames(
      Array.from({ length: titleCount }, (_, index) => `T${String(index)}`),
    );

    // 51 titles × 10 ids = 510 distinct ids: hydration chunks of 500 then 10.
    const gamesRequests = http.requests.filter((r) => r.url === GAMES_URL);
    expect(gamesRequests).toHaveLength(2);
    expect(hydrationIds(gamesRequests[0]?.body ?? '')).toHaveLength(500);
    expect(hydrationIds(gamesRequests[0]?.body ?? '')[0]).toBe(1);
    expect(hydrationIds(gamesRequests[0]?.body ?? '')[499]).toBe(500);
    expect(hydrationIds(gamesRequests[1]?.body ?? '')).toEqual([
      501, 502, 503, 504, 505, 506, 507, 508, 509, 510,
    ]);

    expect(results).toHaveLength(titleCount);
    for (let index = 0; index < titleCount; index += 1) {
      expect(results[index]).toEqual(
        idsForTitle(index).map((id) => ({ id, name: `Game ${String(id)}` })),
      );
    }
  });

  it('resolves the token per HTTP request and re-acquires it across chunks (m3)', async () => {
    let now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    let tokenCount = 0;
    let multiqueryCalls = 0;
    const http = new FakeHttpClient((request) => {
      if (request.url === TOKEN_URL) {
        tokenCount += 1;
        return Promise.resolve(
          httpResponse(200, {
            access_token: `token-${String(tokenCount)}`,
            expires_in: 100,
          }),
        );
      }
      if (request.url === MULTIQUERY_URL) {
        multiqueryCalls += 1;
        // The first token's expiresAt is now + 40s; lapse it before chunk 2.
        if (multiqueryCalls === 1) now += 41_000;
        return Promise.resolve(httpResponse(200, []));
      }
      return Promise.resolve(httpResponse(200, []));
    });
    const client = new IgdbClient(http, config(), permissiveLimiter());

    await client.multiqueryGames(
      Array.from({ length: 11 }, (_, index) => `T${String(index)}`),
    );

    // Two phase-1 chunks, and the cached token had lapsed for the second.
    expect(multiqueryCalls).toBe(2);
    expect(tokenCount).toBe(2);
    nowSpy.mockRestore();
  });

  it('escapes a title that could break out of the search term', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    await client.multiqueryGames(['Halo"; fields name;']);

    const body =
      http.requests.find((r) => r.url === MULTIQUERY_URL)?.body ?? '';
    expect(body).toContain('search "Halo\\"; fields name;";');
  });

  it('routes token plus 2 multiquery chunks through the limiter (no hydration without ids)', async () => {
    const limiter = permissiveLimiter();
    const scheduleSpy = jest.spyOn(limiter, 'schedule');
    const http = new FakeHttpClient((request) =>
      request.url === TOKEN_URL
        ? Promise.resolve(
            httpResponse(200, { access_token: 'token-1', expires_in: 3600 }),
          )
        : Promise.resolve(httpResponse(200, [])),
    );
    const client = new IgdbClient(http, config(), limiter);

    await client.multiqueryGames(
      Array.from({ length: 11 }, (_, i) => `T${String(i)}`),
    );

    // 1 token acquisition + 2 batched searches (10 + 1); no ids -> no hydration.
    expect(scheduleSpy).toHaveBeenCalledTimes(3);
  });

  it('routes token plus 2 searches plus 1 hydration through the limiter when ids exist', async () => {
    const limiter = permissiveLimiter();
    const scheduleSpy = jest.spyOn(limiter, 'schedule');
    const http = new FakeHttpClient((request) => {
      if (request.url === TOKEN_URL) {
        return Promise.resolve(
          httpResponse(200, { access_token: 'token-1', expires_in: 3600 }),
        );
      }
      if (request.url === MULTIQUERY_URL) {
        return Promise.resolve(
          httpResponse(200, [{ name: 'g0', result: [{ id: 1 }] }]),
        );
      }
      return Promise.resolve(httpResponse(200, [{ id: 1, name: 'Halo' }]));
    });
    const client = new IgdbClient(http, config(), limiter);

    await client.multiqueryGames(
      Array.from({ length: 11 }, (_, i) => `T${String(i)}`),
    );

    // Both chunks return the same id -> one deduped hydration request.
    expect(scheduleSpy).toHaveBeenCalledTimes(4);
  });

  it('retries a 429 on the first multiquery call and then hydrates', async () => {
    let multiqueryCalls = 0;
    const { client } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: () => {
          multiqueryCalls += 1;
          return Promise.resolve(
            multiqueryCalls === 1
              ? httpResponse(429, { message: 'too many requests' })
              : httpResponse(200, [{ name: 'g0', result: [{ id: 1 }] }]),
          );
        },
        [GAMES_URL]: () =>
          Promise.resolve(httpResponse(200, [{ id: 1, name: 'Halo' }])),
      }),
    );

    const results = await client.multiqueryGames(['Halo']);

    expect(results).toEqual([[{ id: 1, name: 'Halo' }]]);
    expect(delays.length).toBeGreaterThan(0);
  });

  it('throws a permanent IgdbError when the body is not an array', async () => {
    const { client } = clientWith(() =>
      Promise.resolve(httpResponse(200, { message: 'nope' })),
    );

    const error = await client
      .multiqueryGames(['Halo'])
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(false);
    expect((error as IgdbError).message).toBe(
      'IGDB returned an unexpected response',
    );
  });
});

describe('IgdbClient.fetchPlatforms (unit)', () => {
  it('posts the exact platform query to /v4/platforms', async () => {
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [{ id: 1, name: 'PC' }])),
    );

    await client.fetchPlatforms();

    const request = http.requests.find((r) => r.url === PLATFORMS_URL);
    expect(request?.body).toBe(
      'fields name,abbreviation,alternative_name,platform_family,slug; limit 500;',
    );
    expect(request?.headers['Client-ID']).toBe('client-id');
    expect(request?.headers.Authorization).toBe('Bearer token-1');
  });

  it('parses valid rows and filters malformed entries', async () => {
    const { client } = clientWith(() =>
      Promise.resolve(
        httpResponse(200, [
          { id: 1, name: 'PC', abbreviation: 'PC', platform_family: 4 },
          { id: 2 },
          { name: 'no id' },
          'nope',
        ]),
      ),
    );

    await expect(client.fetchPlatforms()).resolves.toEqual([
      { id: 1, name: 'PC', abbreviation: 'PC', platform_family: 4 },
    ]);
  });

  it('throws a permanent IgdbError when the body is not an array', async () => {
    const { client } = clientWith(() =>
      Promise.resolve(httpResponse(200, { message: 'nope' })),
    );

    const error = await client.fetchPlatforms().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(false);
    expect((error as IgdbError).message).toBe(
      'IGDB returned an unexpected response',
    );
  });

  it('routes through the limiter (token plus one platforms request)', async () => {
    const limiter = permissiveLimiter();
    const scheduleSpy = jest.spyOn(limiter, 'schedule');
    const http = new FakeHttpClient((request) =>
      request.url === TOKEN_URL
        ? Promise.resolve(
            httpResponse(200, { access_token: 'token-1', expires_in: 3600 }),
          )
        : Promise.resolve(httpResponse(200, [])),
    );
    const client = new IgdbClient(http, config(), limiter);

    await client.fetchPlatforms();

    expect(scheduleSpy).toHaveBeenCalledTimes(2);
  });
});

describe('IgdbClient warm-up (unit)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    jest.restoreAllMocks();
  });

  it('does not touch the network under the test runner', async () => {
    process.env.NODE_ENV = 'test';
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    client.onApplicationBootstrap();
    await flushAsync();

    expect(http.requests).toHaveLength(0);
  });

  it('acquires the token on bootstrap in production when credentials are present', async () => {
    process.env.NODE_ENV = 'production';
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    client.onApplicationBootstrap();
    await flushAsync();

    expect(http.requests.filter((r) => r.url === TOKEN_URL)).toHaveLength(1);
  });

  it('never rejects when the token endpoint fails', async () => {
    process.env.NODE_ENV = 'production';
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const http = new FakeHttpClient(() =>
      Promise.reject(new Error('ECONNRESET')),
    );
    const client = new IgdbClient(http, config(), permissiveLimiter());

    await expect(
      (client as unknown as { warmUp(): Promise<void> }).warmUp(),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    expect(http.requests).toHaveLength(1);
  });

  it('skips warm-up without a request when credentials are absent', async () => {
    process.env.NODE_ENV = 'production';
    const http = new FakeHttpClient(() =>
      Promise.resolve(httpResponse(200, [])),
    );
    const client = new IgdbClient(
      http,
      config({ [IGDB_CLIENT_ID_ENV]: undefined }),
      permissiveLimiter(),
    );

    client.onApplicationBootstrap();
    await flushAsync();

    expect(http.requests).toHaveLength(0);
  });
});

describe('FetchIgdbHttpClient (unit)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function post(): Promise<IgdbHttpResponse> {
    return new FetchIgdbHttpClient().post({
      url: GAMES_URL,
      headers: {},
      body: 'x',
      timeoutMs: 5000,
    });
  }

  it('maps a request timeout to a retryable IgdbError', async () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(timeout);

    const error = await post().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(true);
    expect((error as IgdbError).message).toBe('IGDB did not respond in time');
  });

  it('maps a network failure to a retryable IgdbError', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED'));

    const error = await post().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(true);
    expect((error as IgdbError).message).toBe('IGDB could not be reached');
  });
});

describe('IgdbClient recorded fixtures (integration)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses a recorded /v4/games response through the HTTP seam', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    // Envelope derived from `igdb/halo-game.json` (same sanitised payload, full
    // recorded `/v4/games` response shape). Consumed only by this test.
    const fixture = igdbFixture('search-halo-response.json') as unknown[];
    const { client } = clientWith(
      byUrl({
        [GAMES_URL]: () => Promise.resolve(httpResponse(200, fixture)),
      }),
    );

    await expect(client.searchGames('Halo: Combat Evolved')).resolves.toEqual(
      fixture,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('packs titles and parses a recorded /v4/multiquery response, then hydrates', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    // Recorded `/v4/multiquery` body: g0 -> id 1036, g1 -> none.
    const multiquery = igdbFixture(
      'multiquery-halo-response.json',
    ) as unknown[];
    const search = igdbFixture('search-halo-response.json') as unknown[];
    const { client, http } = clientWith(
      byUrl({
        [MULTIQUERY_URL]: () => Promise.resolve(httpResponse(200, multiquery)),
        [GAMES_URL]: () => Promise.resolve(httpResponse(200, search)),
      }),
    );

    const results = await client.multiqueryGames([
      'Halo: Combat Evolved',
      'Unknown',
    ]);

    expect(results).toEqual([[search[0]], []]);
    const multiqueryRequests = http.requests.filter(
      (request) => request.url === MULTIQUERY_URL,
    );
    expect(multiqueryRequests).toHaveLength(1);
    expect(countSubQueries(multiqueryRequests[0]?.body ?? '')).toBe(2);
    const gamesRequests = http.requests.filter(
      (request) => request.url === GAMES_URL,
    );
    expect(gamesRequests).toHaveLength(1);
    expect(hydrationIds(gamesRequests[0]?.body ?? '')).toEqual([1036]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses a recorded /v4/platforms response', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    // Recorded `/v4/platforms` body (PS5 id 167, Xbox id 11, PC id 6).
    const fixture = igdbFixture('platforms-response.json') as unknown[];
    const { client } = clientWith(
      byUrl({
        [PLATFORMS_URL]: () => Promise.resolve(httpResponse(200, fixture)),
      }),
    );

    await expect(client.fetchPlatforms()).resolves.toEqual(fixture);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the refreshed bearer token on the request after the cached token expires', async () => {
    let now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    let tokenCount = 0;
    const http = new FakeHttpClient((request) => {
      if (request.url === TOKEN_URL) {
        tokenCount += 1;
        return Promise.resolve(
          httpResponse(200, {
            access_token: `token-${String(tokenCount)}`,
            expires_in: 100,
          }),
        );
      }
      return Promise.resolve(httpResponse(200, []));
    });
    const client = new IgdbClient(http, config(), permissiveLimiter());

    await client.searchGames('Halo');
    const firstGames = http.requests.filter((r) => r.url === GAMES_URL);
    expect(firstGames[0]?.headers.Authorization).toBe('Bearer token-1');

    // expiresAt = now + (100 - 60)s; step past it and re-request.
    now += 41_000;
    await client.searchGames('Halo 2');

    const games = http.requests.filter((r) => r.url === GAMES_URL);
    expect(games[1]?.headers.Authorization).toBe('Bearer token-2');
    expect(tokenCount).toBe(2);
    nowSpy.mockRestore();
  });

  it('shares a single refresh across concurrent callers when the cached token has expired', async () => {
    let now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    let tokenCount = 0;
    const http = new FakeHttpClient((request) => {
      if (request.url === TOKEN_URL) {
        tokenCount += 1;
        return Promise.resolve(
          httpResponse(200, {
            access_token: `token-${String(tokenCount)}`,
            expires_in: 100,
          }),
        );
      }
      return Promise.resolve(httpResponse(200, []));
    });
    const client = new IgdbClient(http, config(), permissiveLimiter());

    await client.searchGames('Halo');
    expect(tokenCount).toBe(1);

    // Lapse the cached token, then hit it concurrently: both callers must share
    // the single refresh triggered by the first `getToken()`.
    now += 41_000;
    await Promise.all([client.searchGames('A'), client.searchGames('B')]);

    expect(tokenCount).toBe(2);
    const games = http.requests.filter((r) => r.url === GAMES_URL);
    expect(games).toHaveLength(3);
    expect(games[1]?.headers.Authorization).toBe('Bearer token-2');
    expect(games[2]?.headers.Authorization).toBe('Bearer token-2');
    nowSpy.mockRestore();
  });
});
