import type { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { CoverPreviewService } from '../../src/covers/cover-preview.service';
import type { CoverHttpResponse } from '../../src/covers/cover-http.client';
import {
  COVER_PREVIEW_PATH,
  COVER_PREVIEW_TTL_SECONDS,
} from '../../src/covers/covers.options';

const IGDB_URL = 'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg';

function configFor(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

function harness(values: Record<string, string | undefined> = {}) {
  const http = { get: jest.fn<Promise<CoverHttpResponse>, [string]>() };
  const config = configFor({ SESSION_SECRET: 'preview-secret', ...values });
  return {
    service: new CoverPreviewService(config, http),
    http,
  };
}

async function realPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 1, g: 2, b: 3 },
    },
  })
    .png()
    .toBuffer();
}

function signedParams(url: string): { u: string; s: string; e: string } {
  const parsed = new URL(url, 'http://localhost');
  return {
    u: parsed.searchParams.get('u') ?? '',
    s: parsed.searchParams.get('s') ?? '',
    e: parsed.searchParams.get('e') ?? '',
  };
}

/** Narrows a non-null preview URL without a forbidden non-null assertion. */
function previewUrlOf(
  service: CoverPreviewService,
  url: string,
  now?: number,
): string {
  const value = service.previewUrl(url, now);
  if (value === null) {
    throw new Error('expected a preview URL');
  }
  return value;
}

describe('CoverPreviewService (unit)', () => {
  it('builds a same-origin signed preview URL with no external host', () => {
    const h = harness();

    const url = h.service.previewUrl(IGDB_URL);

    expect(url).not.toBeNull();
    expect(url?.startsWith(`${COVER_PREVIEW_PATH}?`)).toBe(true);
    expect(url).not.toContain('images.igdb.com');
    expect(url).not.toContain('://');
  });

  it('returns null when there is no cover', () => {
    const h = harness();
    expect(h.service.previewUrl(null)).toBeNull();
    expect(h.service.previewUrl('   ')).toBeNull();
  });

  it('resolves a correctly signed allowlisted URL', () => {
    const h = harness();
    const { u, s, e } = signedParams(previewUrlOf(h.service, IGDB_URL));

    expect(h.service.resolve(u, s, e)).toBe(IGDB_URL);
  });

  it('rejects a tampered signature or URL', () => {
    const h = harness();
    const { u, s, e } = signedParams(previewUrlOf(h.service, IGDB_URL));
    const tamperedU = Buffer.from(
      'https://images.igdb.com/evil.jpg',
      'utf8',
    ).toString('base64url');

    expect(h.service.resolve(u, `${s}x`, e)).toBeNull();
    expect(h.service.resolve(tamperedU, s, e)).toBeNull();
  });

  it('rejects a non-allowlisted host or non-HTTP scheme', () => {
    const h = harness();
    for (const url of [
      'https://evil.example/x.jpg',
      'ftp://images.igdb.com/x.jpg',
    ]) {
      const { u, s, e } = signedParams(previewUrlOf(h.service, url));
      expect(h.service.resolve(u, s, e)).toBeNull();
    }
  });

  it('rejects an expired preview token and accepts a valid one', () => {
    const h = harness();
    const expired = signedParams(
      previewUrlOf(
        h.service,
        IGDB_URL,
        Date.now() - (COVER_PREVIEW_TTL_SECONDS + 60) * 1000,
      ),
    );
    expect(h.service.resolve(expired.u, expired.s, expired.e)).toBeNull();

    const valid = signedParams(previewUrlOf(h.service, IGDB_URL));
    expect(h.service.resolve(valid.u, valid.s, valid.e)).toBe(IGDB_URL);
  });

  it('rejects a tampered or missing expiry', () => {
    const h = harness();
    const { u, s, e } = signedParams(previewUrlOf(h.service, IGDB_URL));
    // A tampered `e` no longer matches the signed message.
    expect(h.service.resolve(u, s, String(Number(e) + 1))).toBeNull();
    // A missing/garbage `e` is rejected outright.
    expect(h.service.resolve(u, s, undefined)).toBeNull();
    expect(h.service.resolve(u, s, 'not-a-number')).toBeNull();
  });

  it('honours an explicit host allowlist override', () => {
    const h = harness({ COVER_PREVIEW_HOSTS: 'cdn.example.com' });
    const allowed = 'https://cdn.example.com/a.jpg';
    const { u, s, e } = signedParams(previewUrlOf(h.service, allowed));
    expect(h.service.resolve(u, s, e)).toBe(allowed);

    const blocked = signedParams(previewUrlOf(h.service, IGDB_URL));
    expect(h.service.resolve(blocked.u, blocked.s, blocked.e)).toBeNull();
  });

  it('fetches and renders a WebP thumbnail', async () => {
    const h = harness();
    h.http.get.mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'image/png',
      body: await realPng(),
    });

    const asset = await h.service.fetch(IGDB_URL);

    expect(h.http.get).toHaveBeenCalledWith(IGDB_URL);
    expect(asset?.mimeType).toBe('image/webp');
    expect(asset?.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('falls back to the original image bytes when thumbnailing fails', async () => {
    const h = harness();
    const body = Buffer.from('not-an-image');
    h.http.get.mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'image/jpeg',
      body,
    });

    const asset = await h.service.fetch(IGDB_URL);

    expect(asset).toEqual({ buffer: body, mimeType: 'image/jpeg' });
  });

  it('returns null on an HTTP error, a non-image body, or a thrown client', async () => {
    const h = harness();
    h.http.get.mockResolvedValueOnce({
      ok: false,
      status: 404,
      contentType: null,
      body: Buffer.alloc(0),
    });
    await expect(h.service.fetch(IGDB_URL)).resolves.toBeNull();

    h.http.get.mockResolvedValueOnce({
      ok: true,
      status: 200,
      contentType: 'text/html',
      body: Buffer.from('<html/>'),
    });
    await expect(h.service.fetch(IGDB_URL)).resolves.toBeNull();

    h.http.get.mockRejectedValueOnce(new Error('network down'));
    await expect(h.service.fetch(IGDB_URL)).resolves.toBeNull();
  });
});
