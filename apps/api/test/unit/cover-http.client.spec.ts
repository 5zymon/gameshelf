import type { ConfigService } from '@nestjs/config';
import {
  FetchCoverHttpClient,
  type CoverHttpResponse,
} from '../../src/covers/cover-http.client';
import {
  COVER_PREVIEW_HOSTS_ENV,
  COVER_REQUEST_TIMEOUT_MS,
  MAX_COVER_BYTES,
  MAX_COVER_REDIRECTS,
} from '../../src/covers/covers.options';

const COVER_URL =
  'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg';
const REDIRECT_URL =
  'https://images.igdb.com/igdb/image/upload/t_thumb/redirected.jpg';

const originalFetch = global.fetch;

/** Config with an optional `COVER_PREVIEW_HOSTS` override. */
function configFor(hosts?: string): ConfigService {
  return {
    get: (key: string) => (key === COVER_PREVIEW_HOSTS_ENV ? hosts : undefined),
  } as unknown as ConfigService;
}

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
  contentType?: string | null;
  contentLength?: string | null;
  /** The `Location` header of a 3xx response. */
  location?: string | null;
  body?: ReadableStream<Uint8Array> | null;
  /** The final URL `response.url` reports (after redirects). */
  url?: string;
}

/** A minimal `Response` look-alike: the client only reads these members. */
function fakeResponse(init: FakeResponseInit = {}): Response {
  const headers = new Headers();
  if (init.contentType !== undefined && init.contentType !== null) {
    headers.set('content-type', init.contentType);
  }
  if (init.contentLength !== undefined && init.contentLength !== null) {
    headers.set('content-length', init.contentLength);
  }
  if (init.location !== undefined && init.location !== null) {
    headers.set('location', init.location);
  }
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers,
    body: init.body ?? null,
    url: init.url ?? COVER_URL,
  } as unknown as Response;
}

interface ChunkStream {
  stream: ReadableStream<Uint8Array>;
  pulls: () => number;
  cancelled: () => boolean;
}

/** A stream that pulls the given chunks one at a time and records cancellation. */
function chunkStream(chunks: Uint8Array[]): ChunkStream {
  let pulls = 0;
  let cancelled = false;
  let index = 0;
  // `highWaterMark: 0` makes `pull` run only on demand (per `read`), so the
  // pull counter records what the client actually read.
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        const chunk = chunks[index];
        if (chunk !== undefined) {
          controller.enqueue(chunk);
          index += 1;
        } else {
          controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, pulls: () => pulls, cancelled: () => cancelled };
}

describe('FetchCoverHttpClient (unit)', () => {
  let fetchMock: jest.Mock;
  let client: FetchCoverHttpClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    client = new FetchCoverHttpClient(configFor());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reads a streamed body into a Buffer and passes status/content type through', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        contentType: 'image/png',
        body: chunkStream([Buffer.from('ab'), Buffer.from('cd')]).stream,
      }),
    );

    const response = await client.get(COVER_URL);

    expect(response).toEqual({
      ok: true,
      status: 200,
      contentType: 'image/png',
      body: Buffer.from('abcd'),
    } satisfies CoverHttpResponse);
  });

  it('short-circuits an oversize declared Content-Length without reading the body', async () => {
    const body = chunkStream([Buffer.from('never-read')]);
    fetchMock.mockResolvedValue(
      fakeResponse({
        contentType: 'image/jpeg',
        contentLength: String(MAX_COVER_BYTES + 1),
        body: body.stream,
      }),
    );

    const response = await client.get(COVER_URL);

    expect(response.body.length).toBe(0);
    expect(response.contentType).toBe('image/jpeg');
    // The body is released, never buffered: no chunk was pulled from it.
    expect(body.pulls()).toBe(0);
    expect(body.cancelled()).toBe(true);
  });

  it('cancels a chunked body as soon as it exceeds MAX_COVER_BYTES', async () => {
    // No declared Content-Length; each half is below the cap but together they
    // cross it, so the stream must be cancelled after the second chunk.
    const half = Buffer.alloc(Math.ceil((MAX_COVER_BYTES + 1) / 2));
    const body = chunkStream([half, half, Buffer.from('never-read')]);
    fetchMock.mockResolvedValue(
      fakeResponse({ contentType: 'image/jpeg', body: body.stream }),
    );

    const response = await client.get(COVER_URL);

    expect(response.body.length).toBe(0);
    expect(body.cancelled()).toBe(true);
    // Only the two over-cap-crossing chunks were pulled; the trailing one was not.
    expect(body.pulls()).toBe(2);
  });

  it('bounds the request with the 10s timeout signal and rejects when it aborts', async () => {
    const controller = new AbortController();
    const timeoutSpy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(
              new DOMException('The operation was aborted.', 'AbortError'),
            );
          });
        }),
    );

    const promise = client.get(COVER_URL);
    const assertion = expect(promise).rejects.toThrow('aborted');

    expect(timeoutSpy).toHaveBeenCalledWith(COVER_REQUEST_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledWith(
      COVER_URL,
      expect.objectContaining({ signal: controller.signal }),
    );

    controller.abort();
    await assertion;
  });

  it('treats a stream error as a download failure', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('socket hang up'));
      },
    });
    fetchMock.mockResolvedValue(
      fakeResponse({ contentType: 'image/jpeg', body }),
    );

    await expect(client.get(COVER_URL)).rejects.toThrow('socket hang up');
  });

  it('accepts an allowlisted host and issues the request', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        contentType: 'image/jpeg',
        body: chunkStream([Buffer.from('ab')]).stream,
      }),
    );

    await expect(client.get(COVER_URL)).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(COVER_URL, expect.anything());
  });

  it('rejects a non-allowlisted host before issuing the request', async () => {
    await expect(client.get('https://evil.example/x.jpg')).rejects.toThrow(
      /not allowlisted/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-HTTP(S) URL before issuing the request', async () => {
    await expect(client.get('ftp://images.igdb.com/x.jpg')).rejects.toThrow(
      /not allowlisted/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honours the COVER_PREVIEW_HOSTS allowlist override', async () => {
    const override = new FetchCoverHttpClient(configFor('cdn.example.com'));
    fetchMock.mockResolvedValue(
      fakeResponse({
        url: 'https://cdn.example.com/a.jpg',
        contentType: 'image/jpeg',
        body: chunkStream([Buffer.from('ab')]).stream,
      }),
    );

    await expect(
      override.get('https://cdn.example.com/a.jpg'),
    ).resolves.toMatchObject({ ok: true });
    await expect(override.get(COVER_URL)).rejects.toThrow(/not allowlisted/i);
  });

  it('follows an allowlisted redirect and reads the final body', async () => {
    const body = chunkStream([Buffer.from('ab')]);
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse({ status: 302, location: REDIRECT_URL }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          contentType: 'image/jpeg',
          body: body.stream,
        }),
      );

    const response = await client.get(COVER_URL);

    expect(response.body).toEqual(Buffer.from('ab'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      COVER_URL,
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      REDIRECT_URL,
      expect.anything(),
    );
  });

  it('rejects an off-allowlist redirect without fetching the target', async () => {
    const body = chunkStream([Buffer.from('ab')]);
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        status: 302,
        location: 'https://evil.example/x.jpg',
        body: body.stream,
      }),
    );

    await expect(client.get(COVER_URL)).rejects.toThrow(/allowlist/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body.cancelled()).toBe(true);
  });

  it('rejects a redirect with no Location header', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 302 }));

    await expect(client.get(COVER_URL)).rejects.toThrow(/Location/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed redirect Location without fetching the target', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ status: 302, location: 'http://[not-a-host' }),
    );

    await expect(client.get(COVER_URL)).rejects.toThrow(/malformed/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts once the redirect hop cap is exceeded', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ status: 302, location: COVER_URL }),
    );

    await expect(client.get(COVER_URL)).rejects.toThrow(/hops/i);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_COVER_REDIRECTS + 1);
  });
});
