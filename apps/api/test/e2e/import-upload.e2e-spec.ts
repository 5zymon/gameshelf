import type { Server } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { LlmSettingsService } from '../../src/settings/llm-settings.service';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import {
  MAX_UPLOAD_FILE_SIZE_BYTES,
  MAX_UPLOAD_FILES,
} from '../../src/import-jobs/upload.options';
import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import { NO_WORKER } from '../helpers/photo-import-queue';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';
import { seedLlmSettings } from '../helpers/seed';

const UPLOAD_URL = '/import/upload';
const E2E_PHOTO_DIR_SUFFIX = 'gameshelf-import-photos-e2e';

/**
 * Recursively removes the ephemeral e2e photo directory, but only when its
 * resolved path is the e2e temp dir. This guards against a misconfigured
 * `IMPORT_PHOTOS_DIR` (e.g. a developer's real directory) ever being deleted
 * by the suite.
 */
function clearPhotoDir(dir: string): void {
  if (!resolve(dir).endsWith(E2E_PHOTO_DIR_SUFFIX)) {
    throw new Error(
      `Refusing to delete photo directory "${dir}": resolved path does not end with "${E2E_PHOTO_DIR_SUFFIX}"`,
    );
  }
  rmSync(dir, { recursive: true, force: true });
}

interface UploadJobBody {
  id: number;
  jobId: string;
  status: string;
  declaredCount: number | null;
}

interface UploadResponseBody {
  jobs: UploadJobBody[];
}

interface PhotoInput {
  name: string;
  type: string;
  buffer: Buffer;
}

/** The fileFilter only inspects mimetype + extension, so content is arbitrary. */
function pngBuffer(label: string): Buffer {
  return Buffer.from(`not-a-real-png-${label}`);
}

function photo(index: number): PhotoInput {
  return {
    name: `photo-${String(index)}.png`,
    type: 'image/png',
    buffer: pngBuffer(String(index)),
  };
}

type UploadTest = ReturnType<TestApp['request']['post']>;

function uploadRequest(
  test: TestApp,
  files: PhotoInput[],
  declaredCounts?: string[],
): UploadTest {
  let req = test.request.post(UPLOAD_URL);
  for (const file of files) {
    req = req.attach('files', file.buffer, {
      filename: file.name,
      contentType: file.type,
    });
  }
  if (declaredCounts !== undefined) {
    for (const count of declaredCounts) {
      req = req.field('declaredCounts', count);
    }
  }
  return req;
}

describe('Import photo upload API (e2e)', () => {
  let test: TestApp;
  let llm: LlmSettingsService;
  let photoDir: string;

  beforeAll(async () => {
    test = await createTestApp([NO_WORKER]);
    llm = test.app.get(LlmSettingsService);
    photoDir = test.app.get(PhotoStorageService).directory;
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    await seedLlmSettings(test.prisma);
    await test.login();
    clearPhotoDir(photoDir);
  });

  afterAll(async () => {
    await test.app.close();
  });

  it('accepts 5 photos, stores them, and returns one queued job per photo with resolvable job ids', async () => {
    const files = [0, 1, 2, 3, 4].map(photo);

    const res = await uploadRequest(test, files).expect(202);
    const body = res.body as UploadResponseBody;

    expect(body.jobs).toHaveLength(5);
    expect(body.jobs.map((job) => job.status)).toEqual([
      'queued',
      'queued',
      'queued',
      'queued',
      'queued',
    ]);
    expect(body.jobs.map((job) => job.declaredCount)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);

    // One queued row per photo, each with a non-null ephemeral photoRef.
    const rows = await test.prisma.importJob.findMany({
      orderBy: { id: 'asc' },
    });
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.status).toBe('queued');
      expect(row.photoRef).not.toBeNull();
      expect(existsSync(join(photoDir, row.photoRef ?? ''))).toBe(true);
      // The row itself is the queue entry and is immediately runnable.
      expect(row.nextRunAt).not.toBeNull();
      expect(row.attempts).toBe(0);
      expect(row.leaseUntil).toBeNull();
    }
    expect(body.jobs.map((job) => job.id).sort((a, b) => a - b)).toEqual(
      rows.map((row) => row.id),
    );

    // The wire `jobId` is the import_jobs row id, not a Redis job id.
    for (const job of body.jobs) {
      expect(job.jobId).toBe(String(job.id));
    }
  });

  it('treats declaredCounts as optional (omitted → all null)', async () => {
    const res = await uploadRequest(test, [photo(0), photo(1)]).expect(202);

    expect(
      (res.body as UploadResponseBody).jobs.map((job) => job.declaredCount),
    ).toEqual([null, null]);
  });

  it('index-aligns declaredCounts and leaves trailing photos undeclared', async () => {
    const res = await uploadRequest(
      test,
      [photo(0), photo(1), photo(2)],
      ['7'],
    ).expect(202);

    expect(
      (res.body as UploadResponseBody).jobs.map((job) => job.declaredCount),
    ).toEqual([7, null, null]);

    const declared = await test.prisma.importJob.findFirst({
      where: { declaredCount: 7 },
    });
    expect(declared?.photoRef).not.toBeNull();
  });

  it('rejects more declaredCounts than files with 400 and creates nothing', async () => {
    const res = await uploadRequest(test, [photo(0)], ['1', '2']).expect(400);

    expect(res.status).toBe(400);
    expect(await test.prisma.importJob.count()).toBe(0);
  });

  it('rejects an unsupported file type with 400 and creates nothing', async () => {
    await uploadRequest(test, [
      { name: 'notes.txt', type: 'text/plain', buffer: Buffer.from('hi') },
    ]).expect(400);

    expect(await test.prisma.importJob.count()).toBe(0);
  });

  it('rejects an oversized file with 400 (not 413) and creates nothing', async () => {
    await uploadRequest(test, [
      {
        name: 'huge.png',
        type: 'image/png',
        buffer: Buffer.alloc(MAX_UPLOAD_FILE_SIZE_BYTES + 1, 1),
      },
    ]).expect(400);

    expect(await test.prisma.importJob.count()).toBe(0);
  });

  it(`accepts exactly ${String(MAX_UPLOAD_FILES)} photos and queues one job each`, async () => {
    const files = Array.from({ length: MAX_UPLOAD_FILES }, (_, index) =>
      photo(index),
    );

    const res = await uploadRequest(test, files).expect(202);

    expect((res.body as UploadResponseBody).jobs).toHaveLength(
      MAX_UPLOAD_FILES,
    );
    expect(await test.prisma.importJob.count()).toBe(MAX_UPLOAD_FILES);
  });

  it(`rejects ${String(MAX_UPLOAD_FILES + 1)} photos with 400 and creates nothing`, async () => {
    const files = Array.from({ length: MAX_UPLOAD_FILES + 1 }, (_, index) =>
      photo(index),
    );

    await uploadRequest(test, files).expect(400);

    expect(await test.prisma.importJob.count()).toBe(0);
  });

  it('rejects an unexpected multipart file field with 400', async () => {
    await test.request
      .post(UPLOAD_URL)
      .attach('bogus', pngBuffer('x'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(400);
  });

  it('rejects an empty upload with 400', async () => {
    await test.request.post(UPLOAD_URL).expect(400);
  });

  it('returns 503 before storing or enqueuing when no LLM is configured', async () => {
    const spy = jest.spyOn(llm, 'isConfigured').mockResolvedValue(false);

    try {
      await uploadRequest(test, [photo(0)]).expect(503);
      expect(await test.prisma.importJob.count()).toBe(0);
      expect(existsSync(photoDir)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('does no recognition work inline (handler throwing does not break the request)', async () => {
    const handler = test.app.get(PhotoImportHandler);
    const spy = jest
      .spyOn(handler, 'handle')
      .mockRejectedValue(new Error('handler must never run inline'));

    try {
      const res = await uploadRequest(test, [0, 1, 2, 3, 4].map(photo)).expect(
        202,
      );
      expect((res.body as UploadResponseBody).jobs).toHaveLength(5);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns 401 for an unauthenticated request and creates nothing', async () => {
    const server = test.app.getHttpServer() as Server;
    const anon = request.agent(server);

    await anon
      .post(UPLOAD_URL)
      .attach('files', pngBuffer('x'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(401);

    expect(await test.prisma.importJob.count()).toBe(0);
  });
});
