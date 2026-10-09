import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Queue } from 'bullmq';
import type {
  CatalogCandidate,
  CatalogResolution,
} from '../../src/game-catalog/game-catalog.resolver';
import { GameCatalogResolver } from '../../src/game-catalog/game-catalog.resolver';
import { ImportJobsService } from '../../src/import-jobs/import-jobs.service';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import { PHOTO_IMPORT_QUEUE } from '../../src/queue/queue.constants';
import type { RecognizedItem } from '../../src/settings/vision/vision-provider';
import { VisionService } from '../../src/settings/vision/vision.service';
import { resetDatabase } from '../helpers/reset';
import { createTestApp, type TestApp } from '../helpers/test-app';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
};
const queuePrefix = process.env.REDIS_QUEUE_PREFIX ?? 'bull-e2e';
const E2E_PHOTO_DIR_SUFFIX = 'gameshelf-import-photos-e2e';
const PLATFORM_IGDB_ID = 167;

interface ImportJobDetailBody {
  id: number;
  status: string;
  recognizedCount: number;
  importedCount: number;
  unrecognizedCount: number;
  pendingCount: number;
  errorMessage: string | null;
}

function clearPhotoDir(dir: string): void {
  if (!resolve(dir).endsWith(E2E_PHOTO_DIR_SUFFIX)) {
    throw new Error(`Refusing to delete photo directory "${dir}"`);
  }
  rmSync(dir, { recursive: true, force: true });
}

const EXTERNAL_IDS_BY_TITLE = new Map<string, number>();

/**
 * Deterministic, unique-per-title external id. A real catalog returns one
 * record per game, so two differently-titled fixtures must not share an
 * `externalId` (the shared identity rule would otherwise link them into one
 * row).
 */
function externalIdFor(title: string): number {
  const existing = EXTERNAL_IDS_BY_TITLE.get(title);
  if (existing !== undefined) return existing;
  const id = EXTERNAL_IDS_BY_TITLE.size + 1;
  EXTERNAL_IDS_BY_TITLE.set(title, id);
  return id;
}

function candidate(title: string): CatalogCandidate {
  return {
    externalId: externalIdFor(title),
    title,
    releaseYear: 2001,
    publisher: 'Sony Interactive Entertainment',
    genre: 'Action',
    playerCount: null,
    coverUrl: null,
    images: [],
    platforms: [
      { igdbId: PLATFORM_IGDB_ID, name: 'PlayStation 5', abbreviation: 'PS5' },
    ],
    source: 'IGDB',
    raw: { title },
  };
}

describe('Import retry (e2e)', () => {
  let test: TestApp;
  let queue: Queue;
  let photoDir: string;
  let importJobs: ImportJobsService;
  let vision: { recognize: jest.Mock };
  let resolver: { resolve: jest.Mock };

  beforeAll(async () => {
    vision = {
      recognize: jest.fn(() =>
        Promise.resolve({ items: [], countVisible: null }),
      ),
    };
    resolver = {
      resolve: jest.fn((): Promise<CatalogResolution> =>
        Promise.resolve({ kind: 'unrecognized', reason: 'none' }),
      ),
    };
    test = await createTestApp([
      { provide: VisionService, useValue: vision },
      { provide: GameCatalogResolver, useValue: resolver },
    ]);
    importJobs = test.app.get(ImportJobsService);
    photoDir = test.app.get(PhotoStorageService).directory;
    queue = new Queue(PHOTO_IMPORT_QUEUE, { connection, prefix: queuePrefix });
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    await queue.obliterate({ force: true });
    clearPhotoDir(photoDir);
    vision.recognize.mockReset();
    vision.recognize.mockResolvedValue({ items: [], countVisible: null });
    resolver.resolve.mockReset();
    await test.login();
  });

  afterAll(async () => {
    await queue.close();
    await test.app.close();
    clearPhotoDir(photoDir);
  });

  /** Seeds a platform + photo and a partially-processed failed job. */
  async function seedPartiallyProcessed(): Promise<number> {
    const platform = await test.prisma.platform.create({
      data: {
        name: 'PlayStation 5',
        slug: 'playstation-5',
        igdbId: PLATFORM_IGDB_ID,
      },
    });
    const gameA = await test.prisma.game.create({
      data: { title: 'Saved A', platformId: platform.id },
    });
    const gameB = await test.prisma.game.create({
      data: { title: 'Saved B', platformId: platform.id },
    });
    const photoRef = await test.app.get(PhotoStorageService).store({
      originalname: 'shelf.png',
      mimetype: 'image/png',
      buffer: Buffer.from('not-a-real-image'),
    } as Express.Multer.File);
    const job = await test.prisma.importJob.create({
      data: {
        status: 'processing',
        declaredCount: 4,
        photoRef,
        visionCompletedAt: new Date(),
      },
    });
    await test.prisma.recognizedItem.createMany({
      data: [
        {
          importJobId: job.id,
          position: 0,
          rawTitle: 'Saved A',
          confidence: 0.9,
          status: 'imported',
          gameId: gameA.id,
        },
        {
          importJobId: job.id,
          position: 1,
          rawTitle: 'Saved B',
          confidence: 0.9,
          status: 'imported',
          gameId: gameB.id,
        },
        {
          importJobId: job.id,
          position: 2,
          rawTitle: 'Pending A',
          confidence: 0.9,
          status: 'pending',
        },
        {
          importJobId: job.id,
          position: 3,
          rawTitle: 'Pending B',
          confidence: 0.9,
          status: 'pending',
        },
      ],
    });
    await importJobs.markFailed(job.id, 'worker killed mid-job', {
      recognizedCount: 4,
      importedCount: 2,
      unrecognizedCount: 0,
    });
    return job.id;
  }

  async function waitForTerminal(id: number): Promise<ImportJobDetailBody> {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const res = await test.request.get(`/import-jobs/${String(id)}`);
      const body = res.body as ImportJobDetailBody;
      if (
        ['done', 'needs_attention', 'failed', 'dismissed'].includes(body.status)
      ) {
        return body;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error('timed out waiting for a terminal import status');
  }

  it('retries only the unresolved titles and never duplicates saved games', async () => {
    const id = await seedPartiallyProcessed();
    expect(await test.prisma.game.count()).toBe(2);
    resolver.resolve.mockImplementation((item: RecognizedItem) =>
      Promise.resolve({ kind: 'matched', candidate: candidate(item.title) }),
    );

    const retry = await test.request.post(`/import-jobs/${String(id)}/retry`);
    expect(retry.status).toBe(202);
    expect(retry.body as ImportJobDetailBody).toMatchObject({ id });

    const final = await waitForTerminal(id);

    // The two already-saved games stay single; the two pending titles are added.
    expect(await test.prisma.game.count()).toBe(4);
    expect(await test.prisma.game.count({ where: { title: 'Saved A' } })).toBe(
      1,
    );
    expect(await test.prisma.game.count({ where: { title: 'Saved B' } })).toBe(
      1,
    );
    // Only the two pending titles were resolved; vision was not re-run.
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(vision.recognize).not.toHaveBeenCalled();
    expect(final).toMatchObject({
      status: 'done',
      recognizedCount: 4,
      importedCount: 4,
      unrecognizedCount: 0,
      pendingCount: 0,
      errorMessage: null,
    });
  });

  it('refuses to retry a job that is not failed, without enqueueing', async () => {
    const job = await importJobs.createJob({ photoRef: 'p.png' });

    const res = await test.request.post(`/import-jobs/${String(job.id)}/retry`);

    expect(res.status).toBe(409);
    const row = await test.prisma.importJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.status).toBe('queued');
    expect(await queue.getWaitingCount()).toBe(0);
  });

  it('returns 404 for an unknown job', async () => {
    const res = await test.request.post('/import-jobs/999999/retry');

    expect(res.status).toBe(404);
  });
});

describe('Import job durability across an application restart (e2e)', () => {
  it('a failed job, its reason and counts survive a restart', async () => {
    const first = await createTestApp();
    let jobId: number;
    try {
      await resetDatabase(first.prisma);
      const job = await first.prisma.importJob.create({
        data: {
          status: 'failed',
          errorMessage: 'disk full',
          declaredCount: 3,
          recognizedCount: 3,
          importedCount: 1,
          unrecognizedCount: 1,
        },
      });
      jobId = job.id;
    } finally {
      await first.app.close();
    }

    // A fresh application instance reads the same durable row (no reset here).
    const second = await createTestApp();
    try {
      await second.login();
      const res = await second.request.get(`/import-jobs/${String(jobId)}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'failed',
        errorMessage: 'disk full',
        recognizedCount: 3,
        importedCount: 1,
        unrecognizedCount: 1,
        pendingCount: 1,
        needsAttention: false,
      });
    } finally {
      await second.app.close();
    }
  });
});
