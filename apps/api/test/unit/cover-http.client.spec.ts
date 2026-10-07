import {
  FetchCoverHttpClient,
  type CoverHttpResponse,
} from '../../src/covers/cover-http.client';
import {
  COVER_REQUEST_TIMEOUT_MS,
  MAX_COVER_BYTES,
} from '../../src/covers/covers.options';

const COVER_URL =
  'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg';

const originalFetch = global.fetch;

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
  contentType?: string | null;
  contentLength?: string | null;
  body?: ReadableStream<Uint8Array> | null;
}

/** A minimal `Response` look-alike: the client only reads these four members. */
function fakeResponse(init: FakeResponseInit = {}): Response {
  const headers = new Headers();
  if (init.contentType !== undefined && init.contentType !== null) {
    headers.set('content-type', init.contentType);
  }
  if (init.contentLength !== undefined && init.contentLength !== null) {
    headers.set('content-length', init.contentLength);
  }
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers,
    body: init.body ?? null,
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
    client = new FetchCoverHttpClient();
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
});
