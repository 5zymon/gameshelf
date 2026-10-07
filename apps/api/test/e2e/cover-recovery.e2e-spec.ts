import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { CoverCacheService } from '../../src/covers/cover-cache.service';
import {
  CoverHttpClient,
  type CoverHttpResponse,
} from '../../src/covers/cover-http.client';
import { CoverRecoveryService } from '../../src/covers/cover-recovery.service';
import { resetDatabase } from '../helpers/reset';
import { seedGame, seedPlatform } from '../helpers/seed';
import { createTestApp, type TestApp } from '../helpers/test-app';

const E2E_COVERS_DIR_SUFFIX = 'gameshelf-covers-e2e';
const COVER_URL_A = 'https://images.igdb.com/igdb/image/upload/t_thumb/a.jpg';
const COVER_URL_B = 'https://images.igdb.com/igdb/image/upload/t_thumb/b.jpg';

let COVER_BYTES: Buffer;

function servedCover(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 32);
  return `/api/covers/${hash}.jpg`;
}

function fileName(servedUrl: string): string {
  return servedUrl.split('/').pop() ?? '';
}

function clearCoversDir(dir: string): void {
  if (!resolve(dir).endsWith(E2E_COVERS_DIR_SUFFIX)) {
    throw new Error(`Refusing to delete covers directory "${dir}"`);
  }
  rmSync(dir, { recursive: true, force: true });
}

describe('Cover recovery (e2e)', () => {
  let test: TestApp;
  let app: INestApplication;
  let coversDir: string;
  let coverHttp: { get: jest.Mock<Promise<CoverHttpResponse>, [string]> };
  let platformId: number;

  beforeAll(async () => {
    COVER_BYTES = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 3,
        background: { r: 10, g: 120, b: 240 },
      },
    })
      .png()
      .toBuffer();
    coverHttp = { get: jest.fn<Promise<CoverHttpResponse>, [string]>() };
    test = await createTestApp([
      { provide: CoverHttpClient, useValue: coverHttp },
    ]);
    app = test.app;
    coversDir = app.get(CoverCacheService).directory;
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    clearCoversDir(coversDir);
    coverHttp.get.mockReset();
    coverHttp.get.mockResolvedValue({
      ok: true,
      status: 200,
      contentType: 'image/jpeg',
      body: COVER_BYTES,
    });
    platformId = (
      await seedPlatform(test.prisma, {
        name: 'PlayStation 5',
        slug: 'playstation-5',
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
    clearCoversDir(coversDir);
  });

  async function seedLinked(sourceCoverUrl: string, coverUrl: string | null) {
    return seedGame(test.prisma, {
      title: 'Halo',
      platformId,
      coverUrl,
      sourceCoverUrl,
      source: 'IGDB',
      externalId: 7,
    });
  }

  it('repopulates every missing cover after the cover directory is wiped', async () => {
    const linked = await seedLinked(COVER_URL_A, servedCover(COVER_URL_A));
    const placeholder = await seedLinked(COVER_URL_B, null);

    const result = await app.get(CoverRecoveryService).redownloadMissing();

    expect(result).toEqual({
      total: 2,
      downloaded: 2,
      alreadyPresent: 0,
      failed: 0,
      noSource: 0,
    });
    const cache = app.get(CoverCacheService);
    await expect(cache.has(fileName(servedCover(COVER_URL_A)))).resolves.toBe(
      true,
    );
    await expect(cache.has(fileName(servedCover(COVER_URL_B)))).resolves.toBe(
      true,
    );
    await expect(
      cache.readThumbnail(fileName(servedCover(COVER_URL_A))),
    ).resolves.not.toBeNull();

    // The stored path is unchanged when the deterministic name already matches.
    const linkedAfter = await test.prisma.game.findUniqueOrThrow({
      where: { id: linked.id },
    });
    expect(linkedAfter.coverUrl).toBe(servedCover(COVER_URL_A));
    const placeholderAfter = await test.prisma.game.findUniqueOrThrow({
      where: { id: placeholder.id },
    });
    expect(placeholderAfter.coverUrl).toBe(servedCover(COVER_URL_B));
  });

  it('counts already-present covers and is idempotent', async () => {
    await seedLinked(COVER_URL_A, servedCover(COVER_URL_A));

    const first = await app.get(CoverRecoveryService).redownloadMissing();
    expect(first).toMatchObject({ total: 1, downloaded: 1, alreadyPresent: 0 });

    const second = await app.get(CoverRecoveryService).redownloadMissing();
    expect(second).toEqual({
      total: 1,
      downloaded: 0,
      alreadyPresent: 1,
      failed: 0,
      noSource: 0,
    });
  });

  it('counts covers that cannot be recovered (no source link)', async () => {
    await seedLinked(COVER_URL_A, servedCover(COVER_URL_A));
    const platform = await test.prisma.platform.findFirstOrThrow();
    await seedGame(test.prisma, {
      title: 'Manual',
      platformId: platform.id,
      coverUrl: null,
      sourceCoverUrl: null,
    });

    const result = await app.get(CoverRecoveryService).redownloadMissing();

    expect(result.noSource).toBe(1);
    expect(result.total).toBe(1);
  });
});
