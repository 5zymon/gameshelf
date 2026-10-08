import type { Server } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Queue } from 'bullmq';
import request from 'supertest';
import { CoverCacheService } from '../../src/covers/cover-cache.service';
import {
  GameCatalogResolver,
  type CatalogCandidate,
  type CatalogPlatform,
} from '../../src/game-catalog/game-catalog.resolver';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import { PHOTO_IMPORT_QUEUE } from '../../src/queue/queue.constants';
import type { RecognizedItem } from '../../src/settings/vision/vision-provider';
import { VisionService } from '../../src/settings/vision/vision.service';
import { resetDatabase } from '../helpers/reset';
import { seedPlatform } from '../helpers/seed';
import { createTestApp, type TestApp } from '../helpers/test-app';

/**
 * End-to-end acceptance walk of the whole product chain, from an empty
 * database with every external provider stubbed: first-run setup, login,
 * manual add, LLM configuration, a multi-photo import, review + retry, the
 * canonical catalog, the absence of self-registration, and a mid-import
 * application restart. Nothing here touches a live external API.
 */

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
};
const queuePrefix = process.env.REDIS_QUEUE_PREFIX ?? 'bull-e2e';
const E2E_PHOTO_DIR_SUFFIX = 'gameshelf-import-photos-e2e';
const PLATFORM_IGDB_ID = 167;

const ADMIN_EMAIL = 'owner@example.com';
const ADMIN_PASSWORD = 'correct horse battery staple';

/** The seeded canonical PS5 platform every PS5-named item must collapse to. */
const PS5_CATALOG_PLATFORM: CatalogPlatform = {
  igdbId: PLATFORM_IGDB_ID,
  name: 'PlayStation 5',
  abbreviation: 'PS5',
};

function recognizedItem(title: string, platform: string): RecognizedItem {
  return { title, edition: null, platform, confidence: 0.9 };
}

/** What the stubbed vision model "sees" for each uploaded photo buffer. */
const RECOGNITION_BY_MARKER: Record<string, RecognizedItem[]> = {
  'photo:1': [
    recognizedItem('God of War Ragnarök', 'PlayStation 5'),
    recognizedItem('Horizon Forbidden West', 'PS5'),
  ],
  'photo:2': [
    recognizedItem(
      'The Legend of Zelda: Tears of the Kingdom',
      'Nintendo Switch',
    ),
    recognizedItem('Zorblax Chronicles 9000', 'PS5'),
  ],
  'photo:3': [recognizedItem('Hades', 'PlayStation 5')],
  'photo:restart-1': [recognizedItem('Cyberpunk 2077', 'PS5')],
  'photo:restart-2': [recognizedItem('Stellaris', 'PlayStation 5')],
};

/** Deterministic, unique-per-title external id (no shared-identity collisions). */
const EXTERNAL_IDS_BY_TITLE = new Map<string, number>();

function candidate(
  title: string,
  platforms: CatalogPlatform[],
): CatalogCandidate {
  const existing = EXTERNAL_IDS_BY_TITLE.get(title);
  const externalId = existing ?? EXTERNAL_IDS_BY_TITLE.size + 1;
  if (existing === undefined) {
    EXTERNAL_IDS_BY_TITLE.set(title, externalId);
  }
  return {
    externalId,
    title,
    releaseYear: 2001,
    publisher: 'Sony Interactive Entertainment',
    genre: 'Action',
    playerCount: null,
    coverUrl: null,
    platforms,
    source: 'IGDB',
    raw: { title },
  };
}

/** The stubbed external catalog: a candidate per known title, none for Zorblax. */
const CANDIDATE_BY_TITLE: Record<string, CatalogCandidate> = {
  'God of War Ragnarök': candidate('God of War Ragnarök', [
    PS5_CATALOG_PLATFORM,
  ]),
  'Horizon Forbidden West': candidate('Horizon Forbidden West', []),
  'The Legend of Zelda: Tears of the Kingdom': candidate(
    'The Legend of Zelda: Tears of the Kingdom',
    [],
  ),
  Hades: candidate('Hades', [PS5_CATALOG_PLATFORM]),
  'Cyberpunk 2077': candidate('Cyberpunk 2077', [PS5_CATALOG_PLATFORM]),
  Stellaris: candidate('Stellaris', [PS5_CATALOG_PLATFORM]),
};

function clearPhotoDir(dir: string): void {
  if (!resolve(dir).endsWith(E2E_PHOTO_DIR_SUFFIX)) {
    throw new Error(`Refusing to delete photo directory "${dir}"`);
  }
  rmSync(dir, { recursive: true, force: true });
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`condition not met within ${String(timeoutMs)}ms`);
}

interface ImportJobBody {
  status: string;
  recognizedCount: number;
  importedCount: number;
  unrecognizedCount: number;
  errorMessage: string | null;
}

describe('GameShelf full product chain (e2e acceptance)', () => {
  let test: TestApp;
  let server: Server;
  let photoDir: string;
  let ps5PlatformId: number;
  let hadesFails = true;

  // Stub handles, shared by app #1 and the restarted app in step 12.
  let vision: { recognize: jest.Mock };
  let resolver: { resolve: jest.Mock; search: jest.Mock };
  let covers: { cacheFromUrl: jest.Mock };

  // State accumulated across the ordered steps.
  let batchId: string;
  let photo1JobId: number;
  let photo2JobId: number;

  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Criterion 7: prove the run issues no live external requests.
    fetchSpy = jest.spyOn(globalThis, 'fetch');

    vision = { recognize: jest.fn() };
    resolver = { resolve: jest.fn(), search: jest.fn() };
    covers = { cacheFromUrl: jest.fn(() => Promise.resolve(null)) };

    vision.recognize.mockImplementation((input: { image: Buffer }) => {
      const items = RECOGNITION_BY_MARKER[input.image.toString('utf8')] ?? [];
      return Promise.resolve({ items, countVisible: items.length });
    });
    resolver.resolve.mockImplementation((item: RecognizedItem) => {
      if (item.title === 'Hades' && hadesFails) {
        return Promise.reject(
          new Error('catalog backend down (simulated permanent failure)'),
        );
      }
      const match = CANDIDATE_BY_TITLE[item.title];
      return Promise.resolve(
        match
          ? { kind: 'matched' as const, candidate: match }
          : {
              kind: 'unrecognized' as const,
              reason: 'No game matched the title',
            },
      );
    });
    resolver.search.mockResolvedValue({ kind: 'matches', candidates: [] });

    // Clean the shared e2e queue so no leftover job or pause can interfere.
    const rawQueue = new Queue(PHOTO_IMPORT_QUEUE, {
      connection,
      prefix: queuePrefix,
    });
    await rawQueue.obliterate({ force: true });
    await rawQueue.resume();
    await rawQueue.close();

    test = await createTestApp([
      { provide: VisionService, useValue: vision },
      { provide: GameCatalogResolver, useValue: resolver },
      { provide: CoverCacheService, useValue: covers },
    ]);
    server = test.app.getHttpServer() as Server;
    photoDir = test.app.get(PhotoStorageService).directory;
    await resetDatabase(test.prisma);
    clearPhotoDir(photoDir);
    const ps5 = await seedPlatform(test.prisma, {
      name: 'PlayStation 5',
      slug: 'playstation-5',
      abbreviation: 'PS5',
      igdbId: PLATFORM_IGDB_ID,
    });
    ps5PlatformId = ps5.id;
  });

  afterAll(async () => {
    // Capture the count before cleanup so only the product run is measured.
    const fetchCalls = fetchSpy.mock.calls.length;
    await test.app.close();
    clearPhotoDir(photoDir);
    expect(fetchCalls).toBe(0);
    fetchSpy.mockRestore();
  });

  /** Multipart POST /import/upload with one PNG per marker. */
  function uploadFiles(markers: string[]) {
    let req = test.request.post('/import/upload');
    for (const marker of markers) {
      req = req.attach('files', Buffer.from(marker), {
        filename: `${marker.replace(/:/g, '-')}.png`,
        contentType: 'image/png',
      });
    }
    return req;
  }

  async function waitForBatchComplete(id: string): Promise<void> {
    await waitFor(async () => {
      const res = await test.request.get(`/import-jobs/batches/${id}`);
      if (res.status !== 200) return false;
      return (res.body as { allCompleted: boolean }).allCompleted;
    }, 30_000);
  }

  async function waitForJobStatus(
    id: number,
    statuses: string[],
    timeoutMs = 30_000,
  ): Promise<void> {
    await waitFor(async () => {
      const row = await test.prisma.importJob.findUnique({
        where: { id },
      });
      return row !== null && statuses.includes(row.status);
    }, timeoutMs);
  }

  it('1. first-run setup: required -> create admin -> closed -> 409 on repeat', async () => {
    const before = await request(server).get('/setup/status');
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ setupRequired: true });

    const create = await request(server)
      .post('/setup')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(create.status).toBe(201);
    const body = create.body as { user: { email: string } };
    expect(body.user.email).toBe('owner@example.com');
    expect(create.body).not.toHaveProperty('passwordHash');
    expect(body.user).not.toHaveProperty('passwordHash');

    const after = await request(server).get('/setup/status');
    expect(after.status).toBe(200);
    expect(after.body).toEqual({ setupRequired: false });

    expect(await test.prisma.user.count()).toBe(1);

    const repeat = await request(server)
      .post('/setup')
      .send({ email: 'other@example.com', password: 'another password' });
    expect(repeat.status).toBe(409);
    expect(await test.prisma.user.count()).toBe(1);
  });

  it('2. login with the created credentials (session cookie on the agent)', async () => {
    const res = await test.request
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect((res.body as { user: { email: string } }).user.email).toBe(
      ADMIN_EMAIL,
    );
  });

  it('3. manually add a game to the reference platform', async () => {
    const res = await test.request
      .post('/games')
      .send({ title: 'Hollow Knight', platformId: ps5PlatformId });
    expect(res.status).toBe(201);
    const body = res.body as {
      source: string;
      externalId: number | null;
      copyCount: number;
    };
    expect(body.source).toBe('MANUAL');
    expect(body.externalId).toBeNull();
    expect(body.copyCount).toBe(1);
    // No candidate was picked, so the external search is never consulted.
    expect(resolver.search).not.toHaveBeenCalled();
    expect(await test.prisma.game.count()).toBe(1);
  });

  it('4. configure the LLM (stubbed key) and confirm it is active', async () => {
    const put = await test.request
      .put('/settings/llm')
      .send({ provider: 'gemini', apiKey: 'e2e-stub-key' });
    expect(put.status).toBe(200);
    const putBody = put.body as { keyPresent: boolean; importEnabled: boolean };
    expect(putBody.keyPresent).toBe(true);
    expect(putBody.importEnabled).toBe(true);
    // The key is write-only: it must never be echoed back.
    expect(JSON.stringify(put.body)).not.toContain('e2e-stub-key');

    const get = await test.request.get('/settings/llm');
    expect(get.status).toBe(200);
    expect((get.body as { keyPresent: boolean }).keyPresent).toBe(true);
  });

  it('5. upload several photos (mixed platform naming + one unrecognized title)', async () => {
    const res = await uploadFiles(['photo:1', 'photo:2']);
    expect(res.status).toBe(202);
    const body = res.body as {
      batchId: string;
      jobs: { id: number; jobId: string; status: string }[];
    };
    expect(typeof body.batchId).toBe('string');
    expect(body.jobs).toHaveLength(2);
    for (const job of body.jobs) {
      expect(job.status).toBe('queued');
    }
    expect(await test.prisma.importJob.count()).toBe(2);

    const [firstJob, secondJob] = body.jobs;
    if (!firstJob || !secondJob) {
      throw new Error('expected two queued jobs from the upload');
    }
    batchId = body.batchId;
    photo1JobId = firstJob.id;
    photo2JobId = secondJob.id;
  });

  it('6. watch the batch progress to completion', async () => {
    await waitForBatchComplete(batchId);

    const job1Res = await test.request.get(
      `/import-jobs/${String(photo1JobId)}`,
    );
    expect(job1Res.status).toBe(200);
    const job1 = job1Res.body as ImportJobBody;
    expect(job1.status).toBe('done');
    expect(job1.recognizedCount).toBe(2);
    expect(job1.importedCount).toBe(2);
    expect(job1.unrecognizedCount).toBe(0);

    const job2Res = await test.request.get(
      `/import-jobs/${String(photo2JobId)}`,
    );
    expect(job2Res.status).toBe(200);
    const job2 = job2Res.body as ImportJobBody;
    expect(job2.status).toBe('needs_attention');
    expect(job2.recognizedCount).toBe(2);
    expect(job2.importedCount).toBe(1);
    expect(job2.unrecognizedCount).toBe(1);
  });

  it('7. review the flagged items and dismiss one', async () => {
    const review = await test.request.get(
      `/import-jobs/${String(photo2JobId)}/unrecognized`,
    );
    expect(review.status).toBe(200);
    const items = review.body as { id: number; rawTitle: string }[];
    expect(items).toHaveLength(1);
    const flagged = items[0];
    if (!flagged) throw new Error('expected one flagged item');
    expect(flagged.rawTitle).toBe('Zorblax Chronicles 9000');

    const itemId = flagged.id;
    const dismiss = await test.request
      .patch(
        `/import-jobs/${String(photo2JobId)}/unrecognized/${String(itemId)}`,
      )
      .send({ dismissed: true });
    expect(dismiss.status).toBe(200);
    expect(
      (dismiss.body as { dismissedAt: string | null }).dismissedAt,
    ).not.toBeNull();

    const reReview = await test.request.get(
      `/import-jobs/${String(photo2JobId)}/unrecognized`,
    );
    expect(reReview.status).toBe(200);
    expect(reReview.body).toEqual([]);
  });

  it('8. canonical platforms only; unrecognized absent; photos gone', async () => {
    // Mixed naming ("PlayStation 5" vs "PS5") must not create a second platform.
    expect(
      await test.prisma.platform.count({ where: { name: 'PlayStation 5' } }),
    ).toBe(1);
    expect(await test.prisma.platform.count({ where: { name: 'PS5' } })).toBe(
      0,
    );

    const ps5Games = await test.prisma.game.findMany({
      where: {
        title: { in: ['God of War Ragnarök', 'Horizon Forbidden West'] },
      },
    });
    expect(ps5Games).toHaveLength(2);
    for (const game of ps5Games) {
      expect(game.platformId).toBe(ps5PlatformId);
    }

    // An unknown platform is created once, flagged as import-created.
    expect(
      await test.prisma.platform.count({ where: { name: 'Nintendo Switch' } }),
    ).toBe(1);
    const switchPlatform = await test.prisma.platform.findFirstOrThrow({
      where: { name: 'Nintendo Switch' },
    });
    expect(switchPlatform.addedByImport).toBe(true);

    // The unrecognized title is flagged, never in the catalog.
    expect(
      await test.prisma.game.count({
        where: { title: 'Zorblax Chronicles 9000' },
      }),
    ).toBe(0);
    expect(await test.prisma.unrecognizedItem.count()).toBeGreaterThanOrEqual(
      1,
    );

    // Both photos were deleted once their jobs completed.
    for (const id of [photo1JobId, photo2JobId]) {
      const row = await test.prisma.importJob.findUniqueOrThrow({
        where: { id },
      });
      expect(existsSync(join(photoDir, row.photoRef ?? ''))).toBe(false);
    }
  });

  it('9. a failed photo is retried in place and completes', async () => {
    const up = await uploadFiles(['photo:3']);
    expect(up.status).toBe(202);
    const uploadedJob = (up.body as { jobs: { id: number }[] }).jobs[0];
    if (!uploadedJob)
      throw new Error('expected one queued job from the upload');
    const hadesJobId = uploadedJob.id;

    await waitForJobStatus(hadesJobId, ['failed']);
    const failed = await test.prisma.importJob.findUniqueOrThrow({
      where: { id: hadesJobId },
    });
    expect(failed.errorMessage).not.toBeNull();
    expect(await test.prisma.game.count({ where: { title: 'Hades' } })).toBe(0);
    // A failed job keeps its photo for a retry.
    expect(existsSync(join(photoDir, failed.photoRef ?? ''))).toBe(true);

    hadesFails = false;
    const retry = await test.request.post(
      `/import-jobs/${String(hadesJobId)}/retry`,
    );
    expect(retry.status).toBe(202);

    await waitForJobStatus(hadesJobId, ['done']);
    expect(await test.prisma.game.count({ where: { title: 'Hades' } })).toBe(1);
    const done = await test.prisma.importJob.findUniqueOrThrow({
      where: { id: hadesJobId },
    });
    expect(existsSync(join(photoDir, done.photoRef ?? ''))).toBe(false);

    // Vision ran exactly once for this photo: the retry reuses the stored
    // recognition rather than calling the model again.
    const photo3VisionCalls = vision.recognize.mock.calls.filter(
      (call: readonly unknown[]) =>
        (call[0] as { image: Buffer }).image.toString('utf8') === 'photo:3',
    ).length;
    expect(photo3VisionCalls).toBe(1);
  });

  it('10. the catalog contains exactly the expected games', async () => {
    const list = await test.request.get('/games');
    expect(list.status).toBe(200);
    expect((list.body as { meta: { total: number } }).meta.total).toBe(5);

    const search = await test.request.get('/games').query({ q: 'zorblax' });
    expect(search.status).toBe(200);
    expect((search.body as { items: unknown[] }).items).toEqual([]);

    expect(await test.prisma.game.count()).toBe(5);
  });

  it('11. no signup route exists; unauthenticated catalog access is rejected', async () => {
    const forbiddenPaths = [
      '/auth/register',
      '/auth/signup',
      '/auth/sign-up',
      '/register',
      '/signup',
      '/users',
    ];
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
    for (const path of forbiddenPaths) {
      for (const method of methods) {
        const res = await request(server)[method](path);
        expect(res.status).toBe(404);
      }
    }
    // No self-registration means the single admin is still the only account.
    expect(await test.prisma.user.count()).toBe(1);

    // A fresh agent with no session cookie cannot reach the catalog.
    const freshAgent = request.agent(server);
    const unauth = await freshAgent.get('/games');
    expect(unauth.status).toBe(401);
  });

  it('12. queued photos survive a mid-import restart and are still processed', async () => {
    const raw = new Queue(PHOTO_IMPORT_QUEUE, {
      connection,
      prefix: queuePrefix,
    });
    await raw.pause(); // the worker will not pick up new jobs
    try {
      const up = await uploadFiles(['photo:restart-1', 'photo:restart-2']);
      expect(up.status).toBe(202);
      const { batchId: restartBatchId, jobs } = up.body as {
        batchId: string;
        jobs: { jobId: string }[];
      };

      // Deterministically queued: nothing ran while the queue was paused.
      for (const j of jobs) {
        const job = await raw.getJob(j.jobId);
        if (!job) throw new Error(`expected a queued BullMQ job ${j.jobId}`);
        expect(await job.getState()).toBe('waiting');
      }

      await test.app.close(); // worker force-closed mid-import

      const reopened = await createTestApp([
        { provide: VisionService, useValue: vision },
        { provide: GameCatalogResolver, useValue: resolver },
        { provide: CoverCacheService, useValue: covers },
      ]);
      test = reopened; // re-point all later steps/afterAll
      await test.request
        .post('/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .expect(200);

      await raw.resume(); // the pause lives in Redis; release it
      await waitForBatchComplete(restartBatchId); // app #2 drains the two jobs

      expect(
        await test.prisma.game.count({ where: { title: 'Cyberpunk 2077' } }),
      ).toBe(1);
      expect(
        await test.prisma.game.count({ where: { title: 'Stellaris' } }),
      ).toBe(1);
      for (const row of await test.prisma.importJob.findMany({
        where: { batchId: restartBatchId },
      })) {
        expect(existsSync(join(photoDir, row.photoRef ?? ''))).toBe(false);
      }
    } finally {
      await raw.close();
    }
  }, 60_000);
});
