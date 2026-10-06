import { ImportJobsService } from '../../src/import-jobs/import-jobs.service';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import {
  PHOTO_SWEEP_ABANDONED_REASON,
  PHOTO_SWEEP_BATCH_SIZE,
  type PhotoSweepOwner,
} from '../../src/import-jobs/photo-sweep.options';
import { PhotoSweepService } from '../../src/import-jobs/photo-sweep.service';

interface StorageMock {
  list: jest.Mock;
  delete: jest.Mock;
}

interface JobsMock {
  findPhotoOwners: jest.Mock;
  releaseSweptPhoto: jest.Mock;
}

const NOW = new Date('2026-10-06T12:00:00.000Z');
const OLD = new Date('2026-10-06T00:00:00.000Z').getTime();

function owner(overrides: Partial<PhotoSweepOwner> = {}): PhotoSweepOwner {
  return {
    id: 7,
    status: 'done',
    createdAt: NOW,
    enqueuedAt: null,
    completedAt: NOW,
    ...overrides,
  };
}

function createService(): {
  service: PhotoSweepService;
  storage: StorageMock;
  jobs: JobsMock;
} {
  const storage: StorageMock = { list: jest.fn(), delete: jest.fn() };
  const jobs: JobsMock = {
    findPhotoOwners: jest.fn(),
    releaseSweptPhoto: jest.fn(),
  };
  const service = new PhotoSweepService(
    jobs as unknown as ImportJobsService,
    storage as unknown as PhotoStorageService,
  );
  return { service, storage, jobs };
}

describe('PhotoSweepService (unit)', () => {
  let service: PhotoSweepService;
  let storage: StorageMock;
  let jobs: JobsMock;

  beforeEach(() => {
    ({ service, storage, jobs } = createService());
  });

  it('does nothing when the photo directory is empty', async () => {
    storage.list.mockResolvedValue([]);

    await expect(service.sweep(NOW)).resolves.toBeUndefined();

    expect(jobs.findPhotoOwners).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('releases and deletes a terminal leftover photo', async () => {
    storage.list.mockResolvedValue([{ name: 'a.png', mtimeMs: OLD }]);
    jobs.findPhotoOwners.mockResolvedValue(
      new Map([['a.png', owner({ id: 7, status: 'done' })]]),
    );
    jobs.releaseSweptPhoto.mockResolvedValue(true);

    await service.sweep(NOW);

    expect(jobs.releaseSweptPhoto).toHaveBeenCalledWith(
      7,
      'a.png',
      'done',
      undefined,
    );
    expect(storage.delete).toHaveBeenCalledWith('a.png');
  });

  it('does not delete the file when the guarded release loses the race', async () => {
    storage.list.mockResolvedValue([{ name: 'a.png', mtimeMs: OLD }]);
    jobs.findPhotoOwners.mockResolvedValue(
      new Map([['a.png', owner({ id: 7, status: 'done' })]]),
    );
    jobs.releaseSweptPhoto.mockResolvedValue(false);

    await service.sweep(NOW);

    expect(jobs.releaseSweptPhoto).toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('deletes an already-orphaned file without touching the database', async () => {
    storage.list.mockResolvedValue([{ name: 'orphan.png', mtimeMs: OLD }]);
    jobs.findPhotoOwners.mockResolvedValue(new Map());

    await service.sweep(NOW);

    expect(jobs.releaseSweptPhoto).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith('orphan.png');
  });

  it('keeps a file and does not release it while the job is in flight', async () => {
    storage.list.mockResolvedValue([{ name: 'a.png', mtimeMs: OLD }]);
    jobs.findPhotoOwners.mockResolvedValue(
      new Map([['a.png', owner({ id: 7, status: 'queued', createdAt: NOW })]]),
    );

    await service.sweep(NOW);

    expect(jobs.releaseSweptPhoto).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('keeps a failed-retryable photo', async () => {
    storage.list.mockResolvedValue([{ name: 'a.png', mtimeMs: OLD }]);
    jobs.findPhotoOwners.mockResolvedValue(
      new Map([
        ['a.png', owner({ id: 7, status: 'failed', completedAt: NOW })],
      ]),
    );

    await service.sweep(NOW);

    expect(jobs.releaseSweptPhoto).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('fails and deletes an abandoned queued job', async () => {
    const stale = new Date(NOW.getTime() - 49 * 60 * 60 * 1000);
    storage.list.mockResolvedValue([{ name: 'a.png', mtimeMs: OLD }]);
    jobs.findPhotoOwners.mockResolvedValue(
      new Map([
        ['a.png', owner({ id: 7, status: 'queued', createdAt: stale })],
      ]),
    );
    jobs.releaseSweptPhoto.mockResolvedValue(true);

    await service.sweep(NOW);

    expect(jobs.releaseSweptPhoto).toHaveBeenCalledWith(
      7,
      'a.png',
      'queued',
      PHOTO_SWEEP_ABANDONED_REASON,
    );
    expect(storage.delete).toHaveBeenCalledWith('a.png');
  });

  it('keeps a queued photo when the job was retried after creation (regression)', async () => {
    // createdAt is far past the window, but the row was re-enqueued recently:
    // the sweep must not treat a retried job as abandoned.
    const staleCreatedAt = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000);
    storage.list.mockResolvedValue([{ name: 'a.png', mtimeMs: OLD }]);
    jobs.findPhotoOwners.mockResolvedValue(
      new Map([
        [
          'a.png',
          owner({
            id: 7,
            status: 'queued',
            createdAt: staleCreatedAt,
            enqueuedAt: NOW,
          }),
        ],
      ]),
    );

    await service.sweep(NOW);

    expect(jobs.releaseSweptPhoto).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('continues past a failed file deletion and resolves', async () => {
    storage.list.mockResolvedValue([
      { name: 'a.png', mtimeMs: OLD },
      { name: 'b.png', mtimeMs: OLD },
    ]);
    jobs.findPhotoOwners.mockResolvedValue(new Map());
    storage.delete
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValueOnce(undefined);

    await expect(service.sweep(NOW)).resolves.toBeUndefined();

    expect(storage.delete).toHaveBeenCalledTimes(2);
  });

  it('swallows a findPhotoOwners failure and resolves', async () => {
    storage.list.mockResolvedValue([{ name: 'a.png', mtimeMs: OLD }]);
    jobs.findPhotoOwners.mockRejectedValue(new Error('db down'));

    await expect(service.sweep(NOW)).resolves.toBeUndefined();

    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('processes only the first batch of files per pass', async () => {
    const files = Array.from(
      { length: PHOTO_SWEEP_BATCH_SIZE + 1 },
      (_, i) => ({
        name: `f${String(i)}.png`,
        mtimeMs: OLD,
      }),
    );
    storage.list.mockResolvedValue(files);
    jobs.findPhotoOwners.mockResolvedValue(new Map());

    await service.sweep(NOW);

    expect(jobs.findPhotoOwners).toHaveBeenCalledWith(
      files.slice(0, PHOTO_SWEEP_BATCH_SIZE).map((f) => f.name),
    );
    expect(storage.delete).toHaveBeenCalledTimes(PHOTO_SWEEP_BATCH_SIZE);
  });
});
