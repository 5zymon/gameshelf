import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import { Logger } from '@nestjs/common';
import type {
  CatalogCandidate,
  CatalogResolution,
} from '../../src/game-catalog/game-catalog.resolver';
import type {
  ImportBatchOutcome,
  ImportJobsService,
  JobCompletionResult,
  PipelineJobState,
  PipelineRecognizedItem,
  RecognitionItemInput,
} from '../../src/import-jobs/import-jobs.service';
import {
  formatImportJobOutcome,
  PhotoImportPipelineService,
  PLATFORM_NOT_IN_CATALOG_REASON,
} from '../../src/import-jobs/photo-import-pipeline.service';
import type { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import { RetryableImportError } from '../../src/queue/photo-import.failure';
import type { QueueControlService } from '../../src/queue/queue-control.service';
import type { PhotoImportJobData } from '../../src/queue/photo-import.types';
import type {
  RecognizedItem,
  VisionRecognitionResult,
} from '../../src/settings/vision/vision-provider';
import { VisionProviderError } from '../../src/settings/vision/vision.errors';
import type { VisionService } from '../../src/settings/vision/vision.service';

interface Harness {
  pipeline: PhotoImportPipelineService;
  state: PipelineJobState;
  items: PipelineRecognizedItem[];
  games: { title: string }[];
  unrecognizedRows: {
    rawTitle: string;
    rawPlatform: string | null;
    reason: string | null;
  }[];
  jobs: {
    getPipelineJob: jest.Mock;
    findJobIdByPhotoRef: jest.Mock;
    markProcessing: jest.Mock;
    saveRecognition: jest.Mock;
    listPendingRecognizedItems: jest.Mock;
    summarizeRecognizedItems: jest.Mock;
    commitImportBatch: jest.Mock;
    resolvePlatformId: jest.Mock;
    markCompleted: jest.Mock;
    markFailed: jest.Mock;
  };
  storage: { read: jest.Mock; delete: jest.Mock };
  vision: { recognize: jest.Mock };
  resolver: { resolve: jest.Mock; resolveBatch: jest.Mock };
  queueControl: { pauseForConfig: jest.Mock };
}

function makeJob(
  attemptsMade = 0,
  attempts = 3,
  data: Partial<PhotoImportJobData> = {},
): Job<PhotoImportJobData> {
  return {
    id: 'job-1',
    attemptsMade,
    opts: { attempts },
    data: { photoRef: 'photo.png', importJobId: 1, ...data },
  } as unknown as Job<PhotoImportJobData>;
}

function recognized(title: string): RecognizedItem {
  return { title, edition: null, platform: null, confidence: 0.9 };
}

function candidate(title: string): CatalogCandidate {
  return {
    externalId: 1,
    title,
    releaseYear: 2001,
    publisher: null,
    genre: null,
    coverUrl: null,
    platforms: [],
    source: 'IGDB',
    raw: {},
  };
}

/** Extracts a parsed `photo_import_job` structured log line, if present. */
function parseOutcomeLine(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value.startsWith('{')) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed.event === 'photo_import_job' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function createHarness(): Harness {
  const state: PipelineJobState = {
    id: 1,
    status: 'queued',
    declaredCount: null,
    photoRef: 'photo.png',
    visionCompletedAt: null,
    recognizedCount: 0,
    importedCount: 0,
    unrecognizedCount: 0,
  };
  const items: PipelineRecognizedItem[] = [];
  const games: { title: string }[] = [];
  const unrecognizedRows: {
    rawTitle: string;
    rawPlatform: string | null;
    reason: string | null;
  }[] = [];

  const jobs: Harness['jobs'] = {
    getPipelineJob: jest.fn(() => Promise.resolve({ ...state })),
    findJobIdByPhotoRef: jest.fn(() => Promise.resolve(1)),
    markProcessing: jest.fn(() => {
      state.status = 'processing';
      return Promise.resolve();
    }),
    saveRecognition: jest.fn(
      (_jobId: number, inputs: RecognitionItemInput[]) => {
        if (state.visionCompletedAt !== null) {
          return Promise.resolve(0);
        }
        state.visionCompletedAt = new Date();
        inputs.forEach((input, position) => {
          items.push({
            id: position + 1,
            position,
            rawTitle: input.title,
            rawEdition: input.edition,
            rawPlatform: input.platform,
            confidence: input.confidence,
            status: 'pending',
          });
        });
        return Promise.resolve(inputs.length);
      },
    ),
    listPendingRecognizedItems: jest.fn(() =>
      Promise.resolve(
        items
          .filter((item) => item.status === 'pending')
          .map((item) => ({ ...item })),
      ),
    ),
    summarizeRecognizedItems: jest.fn(() =>
      Promise.resolve({
        recognizedCount: items.length,
        importedCount: items.filter((item) => item.status === 'imported')
          .length,
        unrecognizedCount: items.filter(
          (item) => item.status === 'unrecognized',
        ).length,
      }),
    ),
    commitImportBatch: jest.fn(
      (_jobId: number, outcome: ImportBatchOutcome) => {
        for (const resolved of outcome.resolved) {
          games.push({ title: resolved.candidate.title });
          const item = items.find((i) => i.id === resolved.recognizedItemId);
          if (item) item.status = 'imported';
        }
        for (const unrec of outcome.unrecognized) {
          unrecognizedRows.push({
            rawTitle: unrec.rawTitle,
            rawPlatform: unrec.rawPlatform,
            reason: unrec.reason,
          });
          const item = items.find((i) => i.id === unrec.recognizedItemId);
          if (item) item.status = 'unrecognized';
        }
        return Promise.resolve();
      },
    ),
    resolvePlatformId: jest.fn(() => Promise.resolve(10)),
    markCompleted: jest.fn((_jobId: number, result: JobCompletionResult) => {
      state.recognizedCount = result.recognizedCount;
      state.importedCount = result.importedCount;
      state.unrecognizedCount = result.unrecognizedCount;
      const status =
        result.recognizedCount === 0 || result.unrecognizedCount > 0
          ? 'needs_attention'
          : 'done';
      state.status = status;
      return Promise.resolve({ status });
    }),
    markFailed: jest.fn(() => {
      state.status = 'failed';
      return Promise.resolve();
    }),
  };

  const storage: Harness['storage'] = {
    read: jest.fn(() =>
      Promise.resolve({ buffer: Buffer.from('img'), mimeType: 'image/png' }),
    ),
    delete: jest.fn(() => Promise.resolve()),
  };
  const vision: Harness['vision'] = {
    recognize: jest.fn((): Promise<VisionRecognitionResult> =>
      Promise.resolve({ items: [], countVisible: null }),
    ),
  };
  const resolver: Harness['resolver'] = {
    resolve: jest.fn((): Promise<CatalogResolution> =>
      Promise.resolve({ kind: 'unrecognized', reason: 'none' }),
    ),
    resolveBatch: jest.fn(),
  };
  const queueControl: Harness['queueControl'] = {
    pauseForConfig: jest.fn(() => Promise.resolve()),
  };

  const pipeline = new PhotoImportPipelineService(
    jobs as unknown as ImportJobsService,
    storage as unknown as PhotoStorageService,
    vision as unknown as VisionService,
    resolver,
    queueControl as unknown as QueueControlService,
  );
  return {
    pipeline,
    state,
    items,
    games,
    unrecognizedRows,
    jobs,
    storage,
    vision,
    resolver,
    queueControl,
  };
}

describe('PhotoImportPipelineService (unit)', () => {
  it('recognises once, saves every matched title, and deletes the photo after completing', async () => {
    const h = createHarness();
    h.vision.recognize.mockResolvedValue({
      items: [recognized('A'), recognized('B'), recognized('C')],
      countVisible: 3,
    });
    h.resolver.resolve.mockImplementation((item: RecognizedItem) =>
      Promise.resolve({ kind: 'matched', candidate: candidate(item.title) }),
    );

    const result = await h.pipeline.run(makeJob());

    expect(h.vision.recognize).toHaveBeenCalledTimes(1);
    expect(h.jobs.saveRecognition).toHaveBeenCalledTimes(1);
    expect(h.jobs.commitImportBatch).toHaveBeenCalledTimes(1);
    expect(h.games.map((game) => game.title)).toEqual(['A', 'B', 'C']);
    expect(result).toEqual({
      recognizedCount: 3,
      importedCount: 3,
      unrecognizedCount: 0,
    });
    expect(h.state.status).toBe('done');
    expect(h.storage.delete).toHaveBeenCalledWith('photo.png');
    const completedAt = h.jobs.markCompleted.mock.invocationCallOrder;
    const deletedAt = h.storage.delete.mock.invocationCallOrder;
    expect(Math.max(...completedAt)).toBeLessThan(Math.min(...deletedAt));
  });

  it('commits one transaction per batch of 10', async () => {
    const h = createHarness();
    const many = Array.from({ length: 25 }, (_unused, index) =>
      recognized(`G${String(index)}`),
    );
    h.vision.recognize.mockResolvedValue({ items: many, countVisible: 25 });
    h.resolver.resolve.mockImplementation((item: RecognizedItem) =>
      Promise.resolve({ kind: 'matched', candidate: candidate(item.title) }),
    );

    await h.pipeline.run(makeJob());

    expect(
      h.jobs.commitImportBatch.mock.calls.map(
        (call: [number, ImportBatchOutcome]) => call[1].resolved.length,
      ),
    ).toEqual([10, 10, 5]);
    expect(h.games).toHaveLength(25);
  });

  it('on a transient lookup failure retries only the unresolved titles and never calls vision again', async () => {
    const h = createHarness();
    h.vision.recognize.mockResolvedValue({
      items: [recognized('A'), recognized('B'), recognized('C')],
      countVisible: 3,
    });
    let bAttempt = 0;
    h.resolver.resolve.mockImplementation((item: RecognizedItem) => {
      if (item.title === 'B' && bAttempt === 0) {
        return Promise.resolve({ kind: 'transient', reason: '429' });
      }
      return Promise.resolve({
        kind: 'matched',
        candidate: candidate(item.title),
      });
    });

    await expect(h.pipeline.run(makeJob(0, 3))).rejects.toThrow(
      RetryableImportError,
    );
    expect(h.vision.recognize).toHaveBeenCalledTimes(1);
    expect(h.jobs.markFailed).not.toHaveBeenCalled();
    expect(h.items.find((item) => item.rawTitle === 'B')?.status).toBe(
      'pending',
    );
    expect(h.games.map((game) => game.title).sort()).toEqual(['A', 'C']);

    bAttempt = 1;
    const result = await h.pipeline.run(makeJob(1, 3));

    expect(h.vision.recognize).toHaveBeenCalledTimes(1);
    expect(h.games.map((game) => game.title).sort()).toEqual(['A', 'B', 'C']);
    expect(result.importedCount).toBe(3);
    expect(h.storage.delete).toHaveBeenCalledTimes(1);
  });

  it('flags an unmatched title with an unrecognized record and no catalog row', async () => {
    const h = createHarness();
    h.vision.recognize.mockResolvedValue({
      items: [recognized('Mystery')],
      countVisible: 1,
    });
    h.resolver.resolve.mockResolvedValue({
      kind: 'unrecognized',
      reason: 'No IGDB game matched the title',
    });

    const result = await h.pipeline.run(makeJob());

    expect(h.games).toHaveLength(0);
    expect(h.unrecognizedRows).toEqual([
      {
        rawTitle: 'Mystery',
        rawPlatform: null,
        reason: 'No IGDB game matched the title',
      },
    ]);
    expect(result).toEqual({
      recognizedCount: 1,
      importedCount: 0,
      unrecognizedCount: 1,
    });
    expect(h.state.status).toBe('needs_attention');
  });

  it('flags an item whose candidate platform is not in the catalog', async () => {
    const h = createHarness();
    h.vision.recognize.mockResolvedValue({
      items: [recognized('A')],
      countVisible: 1,
    });
    h.resolver.resolve.mockResolvedValue({
      kind: 'matched',
      candidate: candidate('A'),
    });
    h.jobs.resolvePlatformId.mockResolvedValue(null);

    const result = await h.pipeline.run(makeJob());

    expect(h.games).toHaveLength(0);
    // The platform-seed gap is surfaced for review, never silently dropped,
    // and carries the stable, UI-translatable reason token.
    expect(h.unrecognizedRows).toEqual([
      {
        rawTitle: 'A',
        rawPlatform: null,
        reason: PLATFORM_NOT_IN_CATALOG_REASON,
      },
    ]);
    expect(result.unrecognizedCount).toBe(1);
  });

  it('marks the job failed on a non-retryable vision error and keeps the photo', async () => {
    const h = createHarness();
    h.vision.recognize.mockRejectedValue(
      new VisionProviderError('bad_response'),
    );

    await expect(h.pipeline.run(makeJob(0, 3))).rejects.toThrow(
      UnrecoverableError,
    );

    expect(h.jobs.markFailed).toHaveBeenCalledWith(
      1,
      'The provider returned an unexpected response',
      { recognizedCount: 0, importedCount: 0, unrecognizedCount: 0 },
    );
    expect(h.state.status).toBe('failed');
    expect(h.storage.delete).not.toHaveBeenCalled();
  });

  it('marks failed and pauses for an unauthorized vision error without retrying', async () => {
    const h = createHarness();
    h.vision.recognize.mockRejectedValue(
      new VisionProviderError('unauthorized'),
    );

    await expect(h.pipeline.run(makeJob(0, 3))).rejects.toThrow(
      UnrecoverableError,
    );

    expect(h.jobs.markFailed).toHaveBeenCalledWith(
      1,
      'The provider rejected the API key',
      { recognizedCount: 0, importedCount: 0, unrecognizedCount: 0 },
    );
    expect(h.queueControl.pauseForConfig).toHaveBeenCalledWith(
      'llm',
      'The provider rejected the API key',
    );
    expect(h.storage.delete).not.toHaveBeenCalled();
  });

  it('marks failed and pauses on an IGDB config_error resolution', async () => {
    const h = createHarness();
    h.vision.recognize.mockResolvedValue({
      items: [recognized('A')],
      countVisible: 1,
    });
    h.resolver.resolve.mockResolvedValue({
      kind: 'config_error',
      source: 'igdb',
      reason: 'IGDB rejected the credentials',
    });

    await expect(h.pipeline.run(makeJob(0, 3))).rejects.toThrow(
      UnrecoverableError,
    );

    expect(h.queueControl.pauseForConfig).toHaveBeenCalledWith(
      'igdb',
      'IGDB rejected the credentials',
    );
    expect(h.jobs.markFailed).toHaveBeenCalledWith(
      1,
      'IGDB rejected the credentials',
      { recognizedCount: 1, importedCount: 0, unrecognizedCount: 0 },
    );
    // Nothing from the batch is committed: the title stays pending.
    expect(h.games).toHaveLength(0);
    expect(h.items.find((item) => item.rawTitle === 'A')?.status).toBe(
      'pending',
    );
    expect(h.storage.delete).not.toHaveBeenCalled();
  });

  it('pauses the queue consistently on a mobygames config_error resolution', async () => {
    const h = createHarness();
    h.vision.recognize.mockResolvedValue({
      items: [recognized('A')],
      countVisible: 1,
    });
    h.resolver.resolve.mockResolvedValue({
      kind: 'config_error',
      source: 'mobygames',
      reason: 'MobyGames rejected the credentials',
    });

    await expect(h.pipeline.run(makeJob(0, 3))).rejects.toThrow(
      UnrecoverableError,
    );

    expect(h.queueControl.pauseForConfig).toHaveBeenCalledWith(
      'mobygames',
      'MobyGames rejected the credentials',
    );
    expect(h.jobs.markFailed).toHaveBeenCalledWith(
      1,
      'MobyGames rejected the credentials',
      { recognizedCount: 1, importedCount: 0, unrecognizedCount: 0 },
    );
    // Nothing from the batch is committed: the title stays pending.
    expect(h.games).toHaveLength(0);
    expect(h.items.find((item) => item.rawTitle === 'A')?.status).toBe(
      'pending',
    );
    expect(h.storage.delete).not.toHaveBeenCalled();
  });

  it('does not pause on an ordinary permanent vision error', async () => {
    const h = createHarness();
    h.vision.recognize.mockRejectedValue(
      new VisionProviderError('bad_response'),
    );

    await expect(h.pipeline.run(makeJob(0, 3))).rejects.toThrow(
      UnrecoverableError,
    );

    expect(h.queueControl.pauseForConfig).not.toHaveBeenCalled();
  });

  it('a pause failure never masks the config error', async () => {
    const h = createHarness();
    h.vision.recognize.mockRejectedValue(
      new VisionProviderError('unauthorized'),
    );
    h.queueControl.pauseForConfig.mockRejectedValue(new Error('redis down'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(h.pipeline.run(makeJob(0, 3))).rejects.toThrow(
      UnrecoverableError,
    );

    expect(h.jobs.markFailed).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('persists partial counters when a permanent failure follows a committed batch', async () => {
    const h = createHarness();
    const many = Array.from({ length: 12 }, (_unused, index) =>
      recognized(`G${String(index)}`),
    );
    h.vision.recognize.mockResolvedValue({ items: many, countVisible: 12 });
    h.resolver.resolve.mockImplementation((item: RecognizedItem) => {
      if (item.title === 'G10' || item.title === 'G11') {
        return Promise.reject(new Error('worker killed mid-job'));
      }
      return Promise.resolve({
        kind: 'matched',
        candidate: candidate(item.title),
      });
    });

    await expect(h.pipeline.run(makeJob(2, 3))).rejects.toThrow(
      UnrecoverableError,
    );

    expect(h.games).toHaveLength(10);
    expect(h.jobs.markFailed).toHaveBeenCalledWith(
      1,
      'Photo recognition failed unexpectedly',
      { recognizedCount: 12, importedCount: 10, unrecognizedCount: 0 },
    );
    expect(h.state.status).toBe('failed');
    expect(h.storage.delete).not.toHaveBeenCalled();
  });

  it('does not mark a transient vision error failed until the last attempt', async () => {
    const h = createHarness();
    h.vision.recognize.mockRejectedValue(
      new VisionProviderError('rate_limited'),
    );

    await expect(h.pipeline.run(makeJob(0, 3))).rejects.toThrow(
      VisionProviderError,
    );
    expect(h.jobs.markFailed).not.toHaveBeenCalled();

    await expect(h.pipeline.run(makeJob(2, 3))).rejects.toThrow(
      VisionProviderError,
    );
    expect(h.jobs.markFailed).toHaveBeenCalledWith(
      1,
      'The provider rate-limited the request; try again later',
      { recognizedCount: 0, importedCount: 0, unrecognizedCount: 0 },
    );
  });

  it('short-circuits a terminal job without touching vision, storage or status', async () => {
    const h = createHarness();
    h.state.status = 'done';
    h.state.recognizedCount = 4;
    h.state.importedCount = 3;
    h.state.unrecognizedCount = 1;

    const result = await h.pipeline.run(makeJob());

    expect(result).toEqual({
      recognizedCount: 4,
      importedCount: 3,
      unrecognizedCount: 1,
    });
    expect(h.jobs.markProcessing).not.toHaveBeenCalled();
    expect(h.vision.recognize).not.toHaveBeenCalled();
    expect(h.storage.delete).not.toHaveBeenCalled();
  });

  it('resolves the job by photoRef when the payload has no importJobId', async () => {
    const h = createHarness();
    h.jobs.findJobIdByPhotoRef.mockResolvedValue(null);

    await expect(
      h.pipeline.run(makeJob(0, 3, { importJobId: undefined })),
    ).rejects.toThrow(RetryableImportError);
    expect(h.jobs.findJobIdByPhotoRef).toHaveBeenCalledWith('photo.png');
    expect(h.jobs.getPipelineJob).not.toHaveBeenCalled();
  });

  it('still completes when photo deletion fails', async () => {
    const h = createHarness();
    h.vision.recognize.mockResolvedValue({
      items: [recognized('A')],
      countVisible: 1,
    });
    h.resolver.resolve.mockResolvedValue({
      kind: 'matched',
      candidate: candidate('A'),
    });
    h.storage.delete.mockRejectedValue(new Error('disk full'));

    await expect(h.pipeline.run(makeJob())).resolves.toEqual({
      recognizedCount: 1,
      importedCount: 1,
      unrecognizedCount: 0,
    });
    expect(h.jobs.markCompleted).toHaveBeenCalled();
  });

  it('timeout aborts the job and marks it failed on the last attempt', async () => {
    const h = createHarness();
    jest
      .spyOn(
        h.pipeline as unknown as { jobTimeoutMs(): number },
        'jobTimeoutMs',
      )
      .mockReturnValue(20);
    // A hung vision call: never resolves, so only the timeout can settle it.
    h.vision.recognize.mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(h.pipeline.run(makeJob(2, 3))).rejects.toThrow(
      RetryableImportError,
    );

    expect(h.jobs.markFailed).toHaveBeenCalledWith(1, expect.any(String), {
      recognizedCount: 0,
      importedCount: 0,
      unrecognizedCount: 0,
    });
    const structured = warn.mock.calls
      .map((call) => parseOutcomeLine(call[0]))
      .find((entry) => entry !== undefined);
    expect(structured).toMatchObject({
      event: 'photo_import_job',
      outcome: 'failed',
    });
    warn.mockRestore();
  });

  it('schedules a retry (and does not mark failed) when a non-last attempt times out', async () => {
    const h = createHarness();
    jest
      .spyOn(
        h.pipeline as unknown as { jobTimeoutMs(): number },
        'jobTimeoutMs',
      )
      .mockReturnValue(20);
    // A hung vision call: only the timeout can settle the attempt.
    h.vision.recognize.mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(h.pipeline.run(makeJob(0, 3))).rejects.toThrow(
      RetryableImportError,
    );

    expect(h.jobs.markFailed).not.toHaveBeenCalled();
    const structured = warn.mock.calls
      .map((call) => parseOutcomeLine(call[0]))
      .find((entry) => entry !== undefined);
    expect(structured).toMatchObject({
      event: 'photo_import_job',
      outcome: 'retry_scheduled',
    });
    warn.mockRestore();
  });

  it('stops a timed-out attempt at the boundary so it cannot collide with the retry', async () => {
    const h = createHarness();
    jest
      .spyOn(
        h.pipeline as unknown as { jobTimeoutMs(): number },
        'jobTimeoutMs',
      )
      .mockReturnValue(20);
    h.vision.recognize.mockResolvedValue({
      items: [recognized('A')],
      countVisible: 1,
    });
    let release!: (resolution: CatalogResolution) => void;
    const gate = new Promise<CatalogResolution>((resolve) => {
      release = resolve;
    });
    h.resolver.resolve.mockReturnValue(gate);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    // Attempt 1 times out while its only external lookup is still in flight.
    await expect(h.pipeline.run(makeJob(0, 3))).rejects.toThrow(
      RetryableImportError,
    );
    expect(h.jobs.markFailed).not.toHaveBeenCalled();

    // Attempt 2 (the retry) runs to completion while attempt 1 is parked in
    // its lookup — exactly the overlap the cancellation must survive.
    h.resolver.resolve.mockImplementation((item: RecognizedItem) =>
      Promise.resolve({ kind: 'matched', candidate: candidate(item.title) }),
    );
    await expect(h.pipeline.run(makeJob(1, 3))).resolves.toEqual({
      recognizedCount: 1,
      importedCount: 1,
      unrecognizedCount: 0,
    });

    // Resume the abandoned attempt: the abort checkpoint stops it before it
    // commits, so it cannot duplicate or roll back the retry's work.
    release({ kind: 'matched', candidate: candidate('A') });
    await new Promise((resolve) => setImmediate(resolve));

    expect(h.jobs.commitImportBatch).toHaveBeenCalledTimes(1);
    expect(h.games.map((game) => game.title)).toEqual(['A']);
    warn.mockRestore();
  });

  it('logs one structured line with counts, duration and outcome on success', async () => {
    const h = createHarness();
    h.vision.recognize.mockResolvedValue({
      items: [recognized('A'), recognized('B')],
      countVisible: 2,
    });
    h.resolver.resolve.mockImplementation((item: RecognizedItem) =>
      Promise.resolve({ kind: 'matched', candidate: candidate(item.title) }),
    );
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await h.pipeline.run(makeJob());

    const entry = log.mock.calls
      .map((call) => parseOutcomeLine(call[0]))
      .find((parsed) => parsed !== undefined);
    expect(entry).toMatchObject({
      event: 'photo_import_job',
      jobId: 'job-1',
      importJobId: 1,
      photoRef: 'photo.png',
      outcome: 'done',
      recognizedCount: 2,
      importedCount: 2,
      unrecognizedCount: 0,
      attempt: 1,
      maxAttempts: 3,
    });
    expect(entry?.durationMs).toEqual(expect.any(Number));
    log.mockRestore();
  });

  it('logs retry_scheduled for a non-last-attempt transient failure', async () => {
    const h = createHarness();
    h.vision.recognize.mockResolvedValue({
      items: [recognized('A')],
      countVisible: 1,
    });
    h.resolver.resolve.mockResolvedValue({
      kind: 'transient',
      reason: '429',
    });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(h.pipeline.run(makeJob(0, 3))).rejects.toThrow(
      RetryableImportError,
    );

    const entry = warn.mock.calls
      .map((call) => parseOutcomeLine(call[0]))
      .find((parsed) => parsed !== undefined);
    expect(entry).toMatchObject({
      event: 'photo_import_job',
      outcome: 'retry_scheduled',
      attempt: 1,
      maxAttempts: 3,
    });
    expect(entry?.error).toEqual(expect.any(String));
    warn.mockRestore();
  });

  it('formatImportJobOutcome serializes one JSON line and omits an undefined error', () => {
    const line = formatImportJobOutcome({
      jobId: 'job-1',
      importJobId: 7,
      photoRef: 'p.png',
      outcome: 'done',
      recognizedCount: 3,
      importedCount: 2,
      unrecognizedCount: 1,
      durationMs: 12,
      attempt: 1,
      maxAttempts: 3,
    });

    expect(JSON.parse(line)).toEqual({
      event: 'photo_import_job',
      jobId: 'job-1',
      importJobId: 7,
      photoRef: 'p.png',
      outcome: 'done',
      recognizedCount: 3,
      importedCount: 2,
      unrecognizedCount: 1,
      durationMs: 12,
      attempt: 1,
      maxAttempts: 3,
    });
    expect(line).not.toContain('error');
  });
});
