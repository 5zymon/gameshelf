import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  escapeApicalypse,
  IgdbClient,
  IGDB_CLIENT_ID_ENV,
  IGDB_CLIENT_SECRET_ENV,
  parseRetryAfter,
} from '../../src/game-catalog/igdb.client';
import { IgdbError } from '../../src/game-catalog/igdb.errors';
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
const PLATFORMS_URL = 'https://api.igdb.com/v4/platforms';

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
