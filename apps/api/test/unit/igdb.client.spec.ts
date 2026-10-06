import { ConfigService } from '@nestjs/config';
import {
  escapeApicalypse,
  IgdbClient,
  IGDB_CLIENT_ID_ENV,
  IGDB_CLIENT_SECRET_ENV,
} from '../../src/game-catalog/igdb.client';
import { IgdbError } from '../../src/game-catalog/igdb.errors';
import { IGDB_REQUEST_INTERVAL_MS } from '../../src/import-jobs/import-pipeline.options';
import {
  FetchIgdbHttpClient,
  IgdbHttpClient,
  type IgdbHttpRequest,
  type IgdbHttpResponse,
} from '../../src/game-catalog/igdb-http.client';

const TOKEN_URL = 'https://api.igdb.com/v4/access_token';
const GAMES_URL = 'https://api.igdb.com/v4/games';

function httpResponse(status: number, body: unknown): IgdbHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () =>
      Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
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
  return { client: new IgdbClient(http, config()), http };
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

describe('IgdbClient (unit)', () => {
  let delays: number[] = [];

  beforeEach(() => {
    // Instant, recording timers keep the throttle assertion deterministic and
    // the suite fast. The HTTP seam is fully faked, so nothing else waits.
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
    const client = new IgdbClient(http, config());

    await client.searchGames('Halo');
    expect(tokenCount).toBe(1);

    // expiresAt = now + (100 - 60)s; step past it.
    now += 41_000;
    await client.searchGames('Halo 2');
    expect(tokenCount).toBe(2);
    nowSpy.mockRestore();
  });

  it('spaces requests by IGDB_REQUEST_INTERVAL_MS', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { client, http } = clientWith(() =>
      Promise.resolve(httpResponse(200, [])),
    );

    await client.searchGames('Halo');
    nowSpy.mockRestore();

    expect(http.requests).toHaveLength(2);
    expect(delays).toEqual([IGDB_REQUEST_INTERVAL_MS]);
  });

  it('maps a permanent credential error without leaking the secret', async () => {
    const http = new FakeHttpClient(() =>
      Promise.resolve(httpResponse(401, { message: 'Unauthorized' })),
    );
    const client = new IgdbClient(
      http,
      config({ [IGDB_CLIENT_SECRET_ENV]: 'super-secret' }),
    );

    const error = await client.searchGames('Halo').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(false);
    expect((error as IgdbError).message).not.toContain('super-secret');
    expect((error as IgdbError).message).not.toContain('client-secret');
  });

  it('maps a 429 on the games endpoint to a retryable error', async () => {
    const { client } = clientWith(() =>
      Promise.resolve(httpResponse(429, { message: 'too many requests' })),
    );

    const error = await client.searchGames('Halo').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IgdbError);
    expect((error as IgdbError).retryable).toBe(true);
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
