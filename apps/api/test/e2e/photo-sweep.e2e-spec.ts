import type { INestApplication } from '@nestjs/common';
import { existsSync, rmSync, utimesSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Queue } from 'bullmq';
import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import { PHOTO_IMPORT_QUEUE } from '../../src/queue/queue.constants';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import { PHOTO_SWEEP_ABANDONED_REASON } from '../../src/import-jobs/photo-sweep.options';
import { PhotoSweepService } from '../../src/import-jobs/photo-sweep.service';
import { createNoopPhotoImportHandler } from '../helpers/noop-photo-handler';
import { resetDatabase } from '../helpers/reset';
import { createTestApp, type TestApp } from '../helpers/test-app';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
};
const queuePrefix = process.env.REDIS_QUEUE_PREFIX ?? 'bull-e2e';
const E2E_PHOTO_DIR_SUFFIX = 'gameshelf-import-photos-e2e';

function clearPhotoDir(dir: string): void {
  if (!resolve(dir).endsWith(E2E_PHOTO_DIR_SUFFIX)) {
    throw new Error(`Refusing to delete photo directory "${dir}"`);
  }
  rmSync(dir, { recursive: true, force: true });
}

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const FORTY_NINE_HOURS_MS = 49 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

describe('Photo sweep (e2e)', () => {
  let test: TestApp;
  let app: INestApplication;
  let queue: Queue;
  let photoDir: string;
  let storage: PhotoStorageService;
  let sweep: PhotoSweepService;

  beforeAll(async () => {
    test = await createTestApp([
      {
        provide: PhotoImportHandler,
        useValue: createNoopPhotoImportHandler(),
      },
    ]);
    app = test.app;
    storage = app.get(PhotoStorageService);
    photoDir = storage.directory;
    sweep = app.get(PhotoSweepService);
    queue = new Queue(PHOTO_IMPORT_QUEUE, { connection, prefix: queuePrefix });
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    await queue.obliterate({ force: true });
    clearPhotoDir(photoDir);
    await test.login();
  });

  afterAll(async () => {
    await queue.close();
    await app.close();
    clearPhotoDir(photoDir);
  });

  async function storePhoto(): Promise<string> {
    return storage.store({
      originalname: 'shelf.png',
      mimetype: 'image/png',
      buffer: Buffer.from('not-a-real-image'),
    } as Express.Multer.File);
  }

  async function createJob(data: {
    status: string;
    photoRef: string | null;
    createdAt?: Date;
    completedAt?: Date | null;
  }): Promise<number> {
    const row = await test.prisma.importJob.create({
      data: {
        status: data.status,
        photoRef: data.photoRef,
        createdAt: data.createdAt,
        completedAt: data.completedAt ?? null,
      },
    });
    return row.id;
  }

  it('deletes a done job photo leftover', async () => {
    const photoRef = await storePhoto();
    const id = await createJob({ status: 'done', photoRef });

    expect(existsSync(join(photoDir, photoRef))).toBe(true);
    await sweep.sweep();
    expect(existsSync(join(photoDir, photoRef))).toBe(false);

    const row = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(row.photoRef).toBeNull();
  });

  it('deletes a needs_attention job photo leftover', async () => {
    const photoRef = await storePhoto();
    const id = await createJob({ status: 'needs_attention', photoRef });

    await sweep.sweep();

    expect(existsSync(join(photoDir, photoRef))).toBe(false);
    expect(
      (await test.prisma.importJob.findUniqueOrThrow({ where: { id } }))
        .photoRef,
    ).toBeNull();
  });

  it('deletes a dismissed job photo and clears its reference', async () => {
    const photoRef = await storePhoto();
    const id = await createJob({ status: 'dismissed', photoRef });

    await sweep.sweep();

    expect(existsSync(join(photoDir, photoRef))).toBe(false);
    const row = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(row.photoRef).toBeNull();
  });

  it('keeps a failed job photo within the retry window', async () => {
    const photoRef = await storePhoto();
    const id = await createJob({
      status: 'failed',
      photoRef,
      completedAt: new Date(),
    });

    await sweep.sweep();

    expect(existsSync(join(photoDir, photoRef))).toBe(true);
    const row = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(row.photoRef).toBe(photoRef);
  });

  it('deletes a failed job photo past the retry window and refuses a retry', async () => {
    const photoRef = await storePhoto();
    const id = await createJob({
      status: 'failed',
      photoRef,
      completedAt: new Date(Date.now() - EIGHT_DAYS_MS),
    });

    await sweep.sweep();

    expect(existsSync(join(photoDir, photoRef))).toBe(false);
    const row = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(row.status).toBe('failed');
    expect(row.photoRef).toBeNull();

    const retry = await test.request.post(`/import-jobs/${String(id)}/retry`);
    expect(retry.status).toBe(409);
  });

  it('keeps a queued job photo before the abandonment window', async () => {
    const photoRef = await storePhoto();
    const id = await createJob({
      status: 'queued',
      photoRef,
      createdAt: new Date(),
    });

    await sweep.sweep();

    expect(existsSync(join(photoDir, photoRef))).toBe(true);
    const row = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(row.status).toBe('queued');
    expect(row.photoRef).toBe(photoRef);
  });

  it('keeps a retried job photo when createdAt is old but the run is active again', async () => {
    const photoRef = await storePhoto();
    // Created past the 48 h abandonment window, but only failed 3 days ago —
    // still inside the 7-day retry window.
    const id = await createJob({
      status: 'failed',
      photoRef,
      createdAt: new Date(Date.now() - THREE_DAYS_MS),
      completedAt: new Date(Date.now() - THREE_DAYS_MS),
    });

    // Pause the worker so the re-enqueued unit stays `queued` while we sweep.
    await queue.pause();
    try {
      const retry = await test.request.post(`/import-jobs/${String(id)}/retry`);
      expect(retry.status).toBe(202);

      const queued = await test.prisma.importJob.findUniqueOrThrow({
        where: { id },
      });
      expect(queued.status).toBe('queued');
      expect(queued.enqueuedAt).not.toBeNull();

      await sweep.sweep();

      expect(existsSync(join(photoDir, photoRef))).toBe(true);
      const row = await test.prisma.importJob.findUniqueOrThrow({
        where: { id },
      });
      expect(row.status).toBe('queued');
      expect(row.photoRef).toBe(photoRef);
    } finally {
      await queue.resume();
    }
  });

  it('fails and deletes a queued job abandoned past the window', async () => {
    const photoRef = await storePhoto();
    const id = await createJob({
      status: 'queued',
      photoRef,
      createdAt: new Date(Date.now() - FORTY_NINE_HOURS_MS),
    });

    await sweep.sweep();

    expect(existsSync(join(photoDir, photoRef))).toBe(false);
    const row = await test.prisma.importJob.findUniqueOrThrow({
      where: { id },
    });
    expect(row.status).toBe('failed');
    expect(row.errorMessage).toBe(PHOTO_SWEEP_ABANDONED_REASON);
    expect(row.photoRef).toBeNull();
  });

  it('keeps a fresh orphan but deletes a backdated one', async () => {
    const fresh = await storePhoto();
    const old = await storePhoto();
    const backdated = new Date(Date.now() - TWO_HOURS_MS);
    utimesSync(join(photoDir, old), backdated, backdated);

    await sweep.sweep();

    expect(existsSync(join(photoDir, fresh))).toBe(true);
    expect(existsSync(join(photoDir, old))).toBe(false);
  });

  it('never serves processed photos from a gallery-like URL', async () => {
    const photoRef = await storePhoto();
    const id = await createJob({ status: 'done', photoRef });

    for (const path of [
      `/import/photos/${photoRef}`,
      `/photos/${photoRef}`,
      `/uploads/${photoRef}`,
    ]) {
      const res = await test.request.get(path);
      expect(res.status).toBe(404);
    }
    expect(id).toBeGreaterThan(0);
  });
});
