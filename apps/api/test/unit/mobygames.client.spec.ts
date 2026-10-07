import { ConfigService } from '@nestjs/config';
import {
  isMobygamesConfigured,
  MobygamesClient,
  mobygamesApiKey,
} from '../../src/game-catalog/mobygames.client';
import {
  MobygamesConfigError,
  MobygamesError,
} from '../../src/game-catalog/mobygames.errors';
import {
  FetchMobygamesHttpClient,
  type MobygamesHttpRequest,
  type MobygamesHttpResponse,
} from '../../src/game-catalog/mobygames-http.client';
import { MobygamesRateLimiter } from '../../src/game-catalog/mobygames-rate-limiter';

type GetMock = jest.Mock<
  Promise<MobygamesHttpResponse>,
  [MobygamesHttpRequest]
>;

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService;
}

function response(
  overrides: Partial<MobygamesHttpResponse> = {},
): MobygamesHttpResponse {
  return {
    status: 200,
    ok: true,
    json: () => Promise.resolve({ games: [] }),
    ...overrides,
  };
}

function makeClient(
  get: GetMock,
  options: {
    rateLimiter?: MobygamesRateLimiter;
    values?: Record<string, string | undefined>;
  } = {},
): MobygamesClient {
  return new MobygamesClient(
    { get },
    config(options.values ?? { MOBYGAMES_API_KEY: 'test-key' }),
    options.rateLimiter ?? new MobygamesRateLimiter(),
  );
}

describe('mobygamesApiKey / isMobygamesConfigured (unit)', () => {
  it('is false for undefined or a blank value and true otherwise', () => {
    expect(mobygamesApiKey(config({}))).toBeNull();
    expect(mobygamesApiKey(config({ MOBYGAMES_API_KEY: '' }))).toBeNull();
    expect(mobygamesApiKey(config({ MOBYGAMES_API_KEY: '   ' }))).toBeNull();
    expect(isMobygamesConfigured(config({}))).toBe(false);
    expect(isMobygamesConfigured(config({ MOBYGAMES_API_KEY: '' }))).toBe(
      false,
    );

    expect(mobygamesApiKey(config({ MOBYGAMES_API_KEY: '  abc  ' }))).toBe(
      'abc',
    );
    expect(isMobygamesConfigured(config({ MOBYGAMES_API_KEY: 'abc' }))).toBe(
      true,
    );
  });
});

describe('MobygamesClient.searchGames (unit)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('builds the documented GET request', async () => {
    const get = jest
      .fn<Promise<MobygamesHttpResponse>, [MobygamesHttpRequest]>()
      .mockResolvedValue(response());
    const client = makeClient(get);

    await client.searchGames('Halo');

    expect(get).toHaveBeenCalledTimes(1);
    const request = get.mock.calls[0]?.[0];
    if (request === undefined) throw new Error('expected a request');
    const url = new URL(request.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://api.mobygames.com/v2/games',
    );
    expect(url.searchParams.get('title')).toBe('Halo');
    expect(url.searchParams.get('fuzzy')).toBe('true');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('include')).toBe(
      'id,title,genres.,platforms.,covers.',
    );
    expect(url.searchParams.get('api_key')).toBe('test-key');
    expect(request.timeoutMs).toBe(5000);
  });

  it('parses a games response and filters malformed rows', async () => {
    const get = jest
      .fn<Promise<MobygamesHttpResponse>, [MobygamesHttpRequest]>()
      .mockResolvedValue(
        response({
          json: () =>
            Promise.resolve({
              games: [
                { game_id: 1, title: 'Halo' },
                { game_id: 'x', title: 'Bad id' },
                { title: 'No id' },
                null,
              ],
            }),
        }),
      );
    const client = makeClient(get);

    await expect(client.searchGames('Halo')).resolves.toEqual([
      { game_id: 1, title: 'Halo' },
    ]);
  });

  it('routes each request through the limiter', async () => {
    jest.useFakeTimers();
    const starts: number[] = [];
    const get = jest.fn((_request: MobygamesHttpRequest) => {
      starts.push(Date.now());
      return response();
    }) as unknown as GetMock;
    const client = makeClient(get, { rateLimiter: new MobygamesRateLimiter() });

    const first = client.searchGames('A');
    const second = client.searchGames('B');
    await jest.advanceTimersByTimeAsync(1500);
    await Promise.all([first, second]);

    expect(get).toHaveBeenCalledTimes(2);
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(1000);
  });

  it('throws MobygamesConfigError without calling the http seam when the key is absent', async () => {
    const get = jest
      .fn<Promise<MobygamesHttpResponse>, [MobygamesHttpRequest]>()
      .mockResolvedValue(response());
    const client = makeClient(get, { values: {} });

    await expect(client.searchGames('Halo')).rejects.toBeInstanceOf(
      MobygamesConfigError,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'maps HTTP %i to a non-retryable config error',
    async (status) => {
      const get = jest
        .fn<Promise<MobygamesHttpResponse>, [MobygamesHttpRequest]>()
        .mockResolvedValue(response({ status, ok: false }));
      const client = makeClient(get);

      const error = await client.searchGames('Halo').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MobygamesConfigError);
      expect((error as MobygamesError).retryable).toBe(false);
    },
  );

  it.each([429, 500, 503])(
    'maps HTTP %i to a retryable error',
    async (status) => {
      const get = jest
        .fn<Promise<MobygamesHttpResponse>, [MobygamesHttpRequest]>()
        .mockResolvedValue(response({ status, ok: false }));
      const client = makeClient(get);

      const error = await client.searchGames('Halo').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MobygamesError);
      expect((error as MobygamesError).retryable).toBe(true);
    },
  );

  it.each([400, 404, 422])(
    'maps HTTP %i to a permanent error',
    async (status) => {
      const get = jest
        .fn<Promise<MobygamesHttpResponse>, [MobygamesHttpRequest]>()
        .mockResolvedValue(response({ status, ok: false }));
      const client = makeClient(get);

      const error = await client.searchGames('Halo').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MobygamesError);
      expect((error as MobygamesError).retryable).toBe(false);
    },
  );

  it('maps malformed JSON to a permanent error', async () => {
    const get = jest
      .fn<Promise<MobygamesHttpResponse>, [MobygamesHttpRequest]>()
      .mockResolvedValue(
        response({ json: () => Promise.reject(new Error('not json')) }),
      );
    const client = makeClient(get);

    const error = await client.searchGames('Halo').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MobygamesError);
    expect((error as MobygamesError).retryable).toBe(false);
    expect((error as MobygamesError).message).toBe(
      'MobyGames returned malformed JSON',
    );
  });

  it('maps an abort/timeout during the body read to a retryable error', async () => {
    const timeout = new Error('aborted');
    timeout.name = 'TimeoutError';
    const get = jest
      .fn<Promise<MobygamesHttpResponse>, [MobygamesHttpRequest]>()
      .mockResolvedValue(response({ json: () => Promise.reject(timeout) }));
    const client = makeClient(get);

    const error = await client.searchGames('Halo').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MobygamesError);
    expect((error as MobygamesError).retryable).toBe(true);
    expect((error as MobygamesError).message).toBe(
      'MobyGames did not respond in time',
    );
  });

  it('maps a non-array games body to a permanent error', async () => {
    const get = jest
      .fn<Promise<MobygamesHttpResponse>, [MobygamesHttpRequest]>()
      .mockResolvedValue(response({ json: () => Promise.resolve({}) }));
    const client = makeClient(get);

    const error = await client.searchGames('Halo').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MobygamesError);
    expect((error as MobygamesError).retryable).toBe(false);
    expect((error as MobygamesError).message).toBe(
      'MobyGames returned an unexpected response',
    );
  });

  it('propagates a network/timeout error from the http seam as retryable', async () => {
    const get = jest
      .fn<Promise<MobygamesHttpResponse>, [MobygamesHttpRequest]>()
      .mockRejectedValue(
        new MobygamesError(true, 'MobyGames did not respond in time'),
      );
    const client = makeClient(get);

    const error = await client.searchGames('Halo').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MobygamesError);
    expect((error as MobygamesError).retryable).toBe(true);
  });

  it('never includes the api key in an error message', async () => {
    const key = 'super-secret-mobygames-key';
    const get = jest
      .fn<Promise<MobygamesHttpResponse>, [MobygamesHttpRequest]>()
      .mockResolvedValue(response({ status: 401, ok: false }));
    const client = makeClient(get, { values: { MOBYGAMES_API_KEY: key } });

    const error = (await client
      .searchGames('Halo')
      .catch((e: unknown) => e)) as MobygamesError;

    expect(get).toHaveBeenCalledTimes(1);
    expect(error.message).not.toContain(key);
    expect(error.message).not.toContain('api_key');
  });
});

describe('FetchMobygamesHttpClient (unit)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns an ok response and proxies json()', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ games: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const http = new FetchMobygamesHttpClient();

    const response = await http.get({ url: 'https://x/y', timeoutMs: 5000 });

    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ games: [] });
  });

  it('maps a timeout abort to a retryable error', async () => {
    const timeout = new Error('aborted');
    timeout.name = 'TimeoutError';
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(timeout);
    const http = new FetchMobygamesHttpClient();

    const error = await http
      .get({ url: 'https://x/y', timeoutMs: 5000 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MobygamesError);
    expect((error as MobygamesError).retryable).toBe(true);
    expect((error as MobygamesError).message).toBe(
      'MobyGames did not respond in time',
    );
  });

  it('maps a network failure to a retryable error', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('connection refused'));
    const http = new FetchMobygamesHttpClient();

    const error = await http
      .get({ url: 'https://x/y', timeoutMs: 5000 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MobygamesError);
    expect((error as MobygamesError).retryable).toBe(true);
    expect((error as MobygamesError).message).toBe(
      'MobyGames could not be reached',
    );
  });
});
