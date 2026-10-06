import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import type {
  PhotoImportJobData,
  PhotoImportJobResult,
} from '../../src/queue/photo-import.types';
import { PHOTO_IMPORT_QUEUE } from '../../src/queue/queue.constants';
import { resetDatabase } from '../helpers/reset';
import { createTestApp, type TestApp } from '../helpers/test-app';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
};
const queuePrefix = process.env.REDIS_QUEUE_PREFIX ?? 'bull-e2e';
const E2E_PHOTO_DIR_SUFFIX = 'gameshelf-import-photos-e2e';

interface ImportJobBody {
  id: number;
  status: string;
  queueState: string | null;
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

describe('Import live queue state (e2e)', () => {
  let test: TestApp;
  let queue: Queue;
  let photoDir: string;
  let receivedResolve!: (job: Job<PhotoImportJobData>) => void;
  let releaseResolve!: () => void;
  const received = new Promise<Job<PhotoImportJobData>>((done) => {
    receivedResolve = done;
  });
  let gate: Promise<void>;

  beforeAll(async () => {
    gate = new Promise<void>((done) => {
      releaseResolve = done;
    });
    const handler = {
      handle: jest.fn(async (job: Job<PhotoImportJobData>) => {
        receivedResolve(job);
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
    queue = new Queue(PHOTO_IMPORT_QUEUE, { connection, prefix: queuePrefix });
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    await queue.obliterate({ force: true });
    clearPhotoDir(photoDir);
    await test.login();
  });

  afterAll(async () => {
    releaseResolve();
    await queue.close();
    await test.app.close();
    clearPhotoDir(photoDir);
  });

  it('reports the live BullMQ state while the durable row is still queued', async () => {
    const upload = await test.request
      .post('/import/upload')
      .attach('files', Buffer.from('not-a-real-image'), {
        filename: 'shelf.png',
        contentType: 'image/png',
      });

    expect(upload.status).toBe(202);
    const uploadBody = upload.body as {
      batchId: string;
      jobs: { id: number; jobId: string; status: string }[];
    };
    const uploadedJob = uploadBody.jobs[0];
    if (uploadedJob === undefined) {
      throw new Error('upload returned no job');
    }
    expect(uploadBody.batchId).toEqual(expect.any(String));

    // The worker has picked the job up and is blocked inside the handler.
    await received;

    const detail = await test.request.get(
      `/import-jobs/${String(uploadedJob.id)}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      status: 'processing',
      queueState: 'active',
    });

    const list = (await test.request.get('/import-jobs'))
      .body as ImportJobsListBody;
    const listed = list.items[0];
    if (listed === undefined) {
      throw new Error('list returned no items');
    }
    expect(listed).toMatchObject({
      status: 'processing',
      queueState: 'active',
    });

    // Redis is supplementary: the durable row is still queued.
    const row = await test.prisma.importJob.findUniqueOrThrow({
      where: { id: uploadedJob.id },
    });
    expect(row.status).toBe('queued');

    releaseResolve();
  });
});
