import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import type {
  PhotoImportJobResult,
  PhotoImportRun,
} from '../../src/queue/photo-import.types';
import { waitFor } from '../helpers/photo-import-queue';
import { resetDatabase } from '../helpers/reset';
import { seedLlmSettings } from '../helpers/seed';
import { createTestApp, type TestApp } from '../helpers/test-app';

const E2E_PHOTO_DIR_SUFFIX = 'gameshelf-import-photos-e2e';

interface ImportJobBody {
  id: string;
  status: string;
  batchId: string | null;
}

interface ImportJobsListBody {
  items: ImportJobBody[];
}

function clearPhotoDir(dir: string): void {
  if (!resolve(dir).endsWith(E2E_PHOTO_DIR_SUFFIX)) {
    throw new Error(`Refusing to delete photo directory "${dir}"`);
  }
  rmSync(dir, { recursive: true, force: true });
}

describe('Import durable processing state (e2e)', () => {
  let test: TestApp;
  let photoDir: string;
  let receivedResolve!: (run: PhotoImportRun) => void;
  let releaseResolve!: () => void;
  const received = new Promise<PhotoImportRun>((done) => {
    receivedResolve = done;
  });
  let gate: Promise<void>;

  beforeAll(async () => {
    gate = new Promise<void>((done) => {
      releaseResolve = done;
    });
    const handler = {
      handle: jest.fn(async (run: PhotoImportRun) => {
        receivedResolve(run);
        await gate;
        const result: PhotoImportJobResult = {
          recognizedCount: 0,
          importedCount: 0,
          unrecognizedCount: 0,
        };
        return result;
      }),
    };
    test = await createTestApp([
      { provide: PhotoImportHandler, useValue: handler },
    ]);
    photoDir = test.app.get(PhotoStorageService).directory;
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    await seedLlmSettings(test.prisma);
    clearPhotoDir(photoDir);
    await test.login();
  });

  afterAll(async () => {
    releaseResolve();
    await test.app.close();
    clearPhotoDir(photoDir);
  });

  it('exposes a durable processing state with no Redis-backed queue fields', async () => {
    const upload = await test.request
      .post('/import/upload')
      .attach('files', Buffer.from('not-a-real-image'), {
        filename: 'shelf.png',
        contentType: 'image/png',
      });

    expect(upload.status).toBe(202);
    const uploadBody = upload.body as {
      batchId: string;
      jobs: { id: string; jobId: string; status: string }[];
    };
    const uploadedJob = uploadBody.jobs[0];
    if (uploadedJob === undefined) {
      throw new Error('upload returned no job');
    }
    expect(uploadBody.batchId).toEqual(expect.any(String));

    // The worker claimed the row and is blocked inside the handler.
    const run = await received;
    expect(run.importJobId).toBe(uploadedJob.id);
    expect(run.attempt).toBe(1);

    const detail = await test.request.get(`/import-jobs/${uploadedJob.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ status: 'processing' });
    expect(detail.body).not.toHaveProperty('queueState');
    expect(detail.body).not.toHaveProperty('bullJobId');

    const list = (await test.request.get('/import-jobs'))
      .body as ImportJobsListBody;
    const listed = list.items[0];
    if (listed === undefined) {
      throw new Error('list returned no items');
    }
    expect(listed).toMatchObject({ status: 'processing' });
    expect(listed).not.toHaveProperty('queueState');
    expect(listed).not.toHaveProperty('bullJobId');

    // The claim itself is durable: the DB row is `processing` with a lease.
    const row = await test.prisma.importJob.findUniqueOrThrow({
      where: { id: uploadedJob.id },
    });
    expect(row.status).toBe('processing');
    expect(row.attempts).toBe(1);
    expect(row.leaseUntil).not.toBeNull();
    const lease = row.leaseUntil;
    if (lease === null) {
      throw new Error('expected the claim to hold a lease');
    }
    expect(lease.getTime()).toBeGreaterThan(Date.now());

    releaseResolve();
    await waitFor(
      async () =>
        (
          await test.prisma.importJob.findUniqueOrThrow({
            where: { id: uploadedJob.id },
          })
        ).leaseUntil === null,
      15_000,
    );
  }, 30_000);
});
