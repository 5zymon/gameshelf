import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { CoverCacheService } from '../../src/covers/cover-cache.service';
import {
  type CoverHttpClient,
  type CoverHttpResponse,
} from '../../src/covers/cover-http.client';
import {
  COVERS_DIR_ENV,
  COVER_PREVIEW_HOSTS_ENV,
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

function configFor(
  directory: string | undefined,
  previewHosts?: string,
): ConfigService {
  return {
    get: (key: string) => {
      if (key === COVERS_DIR_ENV) return directory;
      if (key === COVER_PREVIEW_HOSTS_ENV) return previewHosts;
      return undefined;
    },
  } as unknown as ConfigService;
}

interface Harness {
  service: CoverCacheService;
  http: { get: jest.Mock<Promise<CoverHttpResponse>, [string]> };
  dir: string;
}

function createHarness(dir: string, previewHosts?: string): Harness {
  const http = {
    get: jest.fn<Promise<CoverHttpResponse>, [string]>(),
  };
  const service = new CoverCacheService(configFor(dir, previewHosts), http);
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
    const extensionless = 'https://cdn.mobygames.com/covers/abc123';
    h.http.get.mockResolvedValue(imageResponse(Buffer.from('jpeg-bytes')));

    const first = await h.service.cacheFromUrl(extensionless);
    const second = await h.service.cacheFromUrl(extensionless);

    expect(first).toBe(`/api/covers/${hashOf(extensionless)}.jpg`);
    expect(second).toBe(first);
    expect(h.http.get).toHaveBeenCalledTimes(1);
  });

  it('reuses a cached cover when the URL extension disagrees with the content type', async () => {
    const h = createHarness(dir);
    const url = 'https://cdn.mobygames.com/covers/picture.png';
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

  it('returns null for a non-allowlisted host without calling the client', async () => {
    const h = createHarness(dir);

    await expect(
      h.service.cacheFromUrl('https://evil.example/cover.jpg'),
    ).resolves.toBeNull();
    expect(h.http.get).not.toHaveBeenCalled();
  });

  it('honours an explicit COVER_PREVIEW_HOSTS override', async () => {
    const h = createHarness(dir, 'cdn.example.com');
    const url = 'https://cdn.example.com/cover.jpg';
    h.http.get.mockResolvedValue(imageResponse(Buffer.from('jpeg-bytes')));

    await expect(h.service.cacheFromUrl(url)).resolves.toBe(
      `/api/covers/${hashOf(url)}.jpg`,
    );
    // A default-allowed host is rejected when the override replaces it.
    await expect(h.service.cacheFromUrl(COVER_URL)).resolves.toBeNull();
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

  it('resolves a relative COVERS_DIR against the repository root', () => {
    const repoRoot = resolve(__dirname, '../../../..');
    const service = new CoverCacheService(
      configFor('covers-relative'),
      {} as unknown as CoverHttpClient,
    );

    expect(service.directory).toBe(join(repoRoot, 'covers-relative'));
  });

  it('uses the configured directory and trims it', () => {
    const service = new CoverCacheService(
      configFor(`  ${dir}  `),
      {} as unknown as CoverHttpClient,
    );

    expect(service.directory).toBe(dir);
  });

  describe('thumbnails', () => {
    async function realPng(): Promise<Buffer> {
      return sharp({
        create: {
          width: 64,
          height: 64,
          channels: 3,
          background: { r: 10, g: 20, b: 30 },
        },
      })
        .png()
        .toBuffer();
    }

    it('generates a local WebP thumbnail on download and serves it', async () => {
      const h = createHarness(dir);
      h.http.get.mockResolvedValue(imageResponse(await realPng(), 'image/png'));

      const served = await h.service.cacheFromUrl(COVER_URL);
      const file = served?.split('/').pop() ?? '';

      const thumb = await h.service.readThumbnail(file);
      expect(thumb).not.toBeNull();
      expect(thumb?.mimeType).toBe('image/webp');
      // WebP magic number ("RIFF"…"WEBP") proves it was rendered locally.
      expect(thumb?.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(thumb?.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
      const meta = await sharp(thumb?.buffer).metadata();
      expect(meta.width).toBeLessThanOrEqual(300);

      await expect(h.service.has(file)).resolves.toBe(true);
      expect(h.service.servedThumbnailUrl(file)).toBe(
        `/api/covers/thumbs/${file}`,
      );
    });

    it('ensureThumbnail returns false for undecodable bytes and true for a real image', async () => {
      const h = createHarness(dir);
      h.http.get.mockResolvedValue(imageResponse(Buffer.from('not-an-image')));
      const served = await h.service.cacheFromUrl(COVER_URL);
      const file = served?.split('/').pop() ?? '';

      await expect(h.service.ensureThumbnail(file)).resolves.toBe(false);

      // Replace the stored file with a decodable one and retry.
      await writeFile(join(dir, file), await realPng());
      await expect(h.service.ensureThumbnail(file)).resolves.toBe(true);
      await expect(h.service.ensureThumbnail('../escape.jpg')).resolves.toBe(
        false,
      );
    });

    it('removeByServedUrl deletes the cover and its thumbnail', async () => {
      const h = createHarness(dir);
      h.http.get.mockResolvedValue(imageResponse(await realPng(), 'image/png'));
      const served = await h.service.cacheFromUrl(COVER_URL);
      const file = served?.split('/').pop() ?? '';
      expect(await h.service.readThumbnail(file)).not.toBeNull();

      await h.service.removeByServedUrl(served);

      await expect(h.service.has(file)).resolves.toBe(false);
      await expect(h.service.readThumbnail(file)).resolves.toBeNull();
      // A non-cover / missing path is a silent no-op.
      await expect(
        h.service.removeByServedUrl('/api/covers/../../etc/passwd'),
      ).resolves.toBeUndefined();
      await expect(h.service.removeByServedUrl(null)).resolves.toBeUndefined();
    });

    it('fileFromServedUrl only accepts a same-origin cover path', () => {
      const h = createHarness(dir);
      const name = `${'a'.repeat(32)}.jpg`;
      expect(h.service.fileFromServedUrl(`/api/covers/${name}`)).toBe(name);
      expect(
        h.service.fileFromServedUrl('https://evil.example/x.jpg'),
      ).toBeNull();
      expect(
        h.service.fileFromServedUrl('/api/covers/not-a-hash.jpg'),
      ).toBeNull();
      expect(h.service.fileFromServedUrl('/api/covers/../x.jpg')).toBeNull();
    });

    it('readThumbnail rejects unsafe names', async () => {
      const h = createHarness(dir);
      await expect(h.service.readThumbnail('../x.jpg')).resolves.toBeNull();
      await expect(
        h.service.readThumbnail('not-a-hash.jpg'),
      ).resolves.toBeNull();
    });
  });
});
