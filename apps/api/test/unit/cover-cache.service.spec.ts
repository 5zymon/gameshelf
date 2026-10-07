import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoverCacheService } from '../../src/covers/cover-cache.service';
import {
  type CoverHttpClient,
  type CoverHttpResponse,
} from '../../src/covers/cover-http.client';
import {
  COVERS_DIR_ENV,
  DEFAULT_COVERS_DIR,
  MAX_COVER_BYTES,
} from '../../src/covers/covers.options';

const COVER_URL =
  'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg';

function hashOf(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 32);
}

function imageResponse(
  body: Buffer,
  contentType = 'image/jpeg',
): CoverHttpResponse {
  return { ok: true, status: 200, contentType, body };
}

function configFor(directory: string | undefined): ConfigService {
  return {
    get: (key: string) => (key === COVERS_DIR_ENV ? directory : undefined),
  } as unknown as ConfigService;
}

interface Harness {
  service: CoverCacheService;
  http: { get: jest.Mock<Promise<CoverHttpResponse>, [string]> };
  dir: string;
}

function createHarness(dir: string): Harness {
  const http = {
    get: jest.fn<Promise<CoverHttpResponse>, [string]>(),
  };
  const service = new CoverCacheService(configFor(dir), http);
  return { service, http, dir };
}

describe('CoverCacheService (unit)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gameshelf-covers-unit-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('downloads bytes and returns a same-origin served path with a deterministic hash', async () => {
    const h = createHarness(dir);
    const bytes = Buffer.from('jpeg-bytes');
    h.http.get.mockResolvedValue(imageResponse(bytes));

    const served = await h.service.cacheFromUrl(COVER_URL);

    expect(served).toBe(`/api/covers/${hashOf(COVER_URL)}.jpg`);
    expect(h.http.get).toHaveBeenCalledWith(COVER_URL);
  });

  it('serves the cached file on a second call without re-downloading', async () => {
    const h = createHarness(dir);
    h.http.get.mockResolvedValue(imageResponse(Buffer.from('jpeg-bytes')));

    const first = await h.service.cacheFromUrl(COVER_URL);
    const second = await h.service.cacheFromUrl(COVER_URL);

    expect(second).toBe(first);
    expect(h.http.get).toHaveBeenCalledTimes(1);
  });

  it('reuses a cached cover when the URL has no extension', async () => {
    const h = createHarness(dir);
    const extensionless = 'https://cdn.example.com/covers/abc123';
    h.http.get.mockResolvedValue(imageResponse(Buffer.from('jpeg-bytes')));

    const first = await h.service.cacheFromUrl(extensionless);
    const second = await h.service.cacheFromUrl(extensionless);

    expect(first).toBe(`/api/covers/${hashOf(extensionless)}.jpg`);
    expect(second).toBe(first);
    expect(h.http.get).toHaveBeenCalledTimes(1);
  });

  it('reuses a cached cover when the URL extension disagrees with the content type', async () => {
    const h = createHarness(dir);
    const url = 'https://cdn.example.com/covers/picture.png';
    // The response is JPEG, so the file is written as `<hash>.jpg` even though
    // the URL says `.png`; the second call must still find it.
    h.http.get.mockResolvedValue(imageResponse(Buffer.from('jpeg-bytes')));

    const first = await h.service.cacheFromUrl(url);
    const second = await h.service.cacheFromUrl(url);

    expect(first).toBe(`/api/covers/${hashOf(url)}.jpg`);
    expect(second).toBe(first);
    expect(h.http.get).toHaveBeenCalledTimes(1);
  });

  it('returns null for a null or blank URL without calling the client', async () => {
    const h = createHarness(dir);

    await expect(h.service.cacheFromUrl(null)).resolves.toBeNull();
    await expect(h.service.cacheFromUrl('   ')).resolves.toBeNull();
    expect(h.http.get).not.toHaveBeenCalled();
  });

  it('returns null for a non-HTTP(S) protocol (SSRF guard)', async () => {
    const h = createHarness(dir);

    await expect(
      h.service.cacheFromUrl('ftp://example.com/cover.jpg'),
    ).resolves.toBeNull();
    expect(h.http.get).not.toHaveBeenCalled();
  });

  it('returns null for a non-image content type and writes nothing', async () => {
    const h = createHarness(dir);
    h.http.get.mockResolvedValue(
      imageResponse(Buffer.from('<html></html>'), 'text/html'),
    );

    await expect(h.service.cacheFromUrl(COVER_URL)).resolves.toBeNull();
  });

  it('returns null for an empty or oversize body', async () => {
    const h = createHarness(dir);
    h.http.get.mockResolvedValueOnce(imageResponse(Buffer.alloc(0)));
    await expect(h.service.cacheFromUrl(COVER_URL)).resolves.toBeNull();

    h.http.get.mockResolvedValueOnce(
      imageResponse(Buffer.alloc(MAX_COVER_BYTES + 1)),
    );
    await expect(h.service.cacheFromUrl(COVER_URL)).resolves.toBeNull();
  });

  it('never throws: a client error degrades to null', async () => {
    const h = createHarness(dir);
    h.http.get.mockRejectedValue(new Error('network down'));

    await expect(h.service.cacheFromUrl(COVER_URL)).resolves.toBeNull();
  });

  it('read round-trips the stored bytes and mime type', async () => {
    const h = createHarness(dir);
    const bytes = Buffer.from('jpeg-bytes');
    h.http.get.mockResolvedValue(imageResponse(bytes));
    const served = await h.service.cacheFromUrl(COVER_URL);
    const file = served?.split('/').pop() ?? '';

    const asset = await h.service.read(file);

    expect(asset).toEqual({ buffer: bytes, mimeType: 'image/jpeg' });
  });

  it('read rejects traversal and returns null for a missing file', async () => {
    const h = createHarness(dir);

    await expect(h.service.read('../x.jpg')).resolves.toBeNull();
    await expect(h.service.read(`${'a'.repeat(32)}.jpg`)).resolves.toBeNull();
    await expect(h.service.read('not-a-hash.jpg')).resolves.toBeNull();
  });

  it('falls back to the default directory when COVERS_DIR is blank', () => {
    const service = new CoverCacheService(
      configFor(''),
      {} as unknown as CoverHttpClient,
    );

    expect(service.directory).toBe(DEFAULT_COVERS_DIR);
  });

  it('uses the configured directory and trims it', () => {
    const service = new CoverCacheService(
      configFor(`  ${dir}  `),
      {} as unknown as CoverHttpClient,
    );

    expect(service.directory).toBe(dir);
  });
});
