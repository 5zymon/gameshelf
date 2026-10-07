import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CatalogCandidate,
  CatalogPlatform,
} from '../game-catalog/game-catalog.resolver';
import { findPlatformMatch } from '../platforms/platform-match';
import type { PhotoImportJobData } from '../queue/photo-import.types';
import { RetryableImportError } from '../queue/photo-import.failure';
import { PHOTO_IMPORT_QUEUE } from '../queue/queue.constants';
import { QueueControlService } from '../queue/queue-control.service';
import { ListImportJobsQueryDto } from './dto/list-import-jobs-query.dto';
import {
  ImportBatchProgressModel,
  ImportJobDetailModel,
  ImportJobModel,
  ImportQueueStateModel,
  ListImportJobsResponseModel,
  UnrecognizedItemModel,
} from './dto/import-job-response.model';
import {
  isTerminalImportJobStatus,
  mergeImportJobStatus,
} from './import-job-status';
import { IMPORT_QUEUE_STATE_TIMEOUT_MS } from './import-pipeline.options';
import type { PhotoSweepOwner } from './photo-sweep.options';

/**
 * ADR-002 job result contract: the three counts the processor reports.
 * The service computes `done` vs `needs_attention` from them (spec §4.2.4);
 * the processor (ticket 3.5) only reports numbers.
 */
export interface JobCompletionResult {
  /** Detected items — every outcome the model reported (spec §4.2.3). */
  recognizedCount: number;
  /** Items saved to the catalog. */
  importedCount: number;
  /** Flagged items: unrecognized + unreadable. */
  unrecognizedCount: number;
}

/** One persisted recognized item as listed for batch resolution. */
export interface PipelineRecognizedItem {
  id: number;
  position: number;
  rawTitle: string;
  rawEdition: string | null;
  rawPlatform: string | null;
  confidence: number;
  status: string;
}

/** The slice of an import job the pipeline needs before it starts work. */
export interface PipelineJobState {
  id: number;
  status: string;
  declaredCount: number | null;
  photoRef: string | null;
  visionCompletedAt: Date | null;
  recognizedCount: number;
  importedCount: number;
  unrecognizedCount: number;
}

/** One vision item persisted as a pending recognized item. */
export interface RecognitionItemInput {
  title: string;
  edition: string | null;
  platform: string | null;
  confidence: number;
}

/** A title that resolved to a catalog candidate and can be saved. */
export interface ResolvedImport {
  recognizedItemId: number;
  platformId: number;
  /** Vision-read edition — the catalog's first-class attribute. */
  edition: string | null;
  candidate: CatalogCandidate;
}

/** A title that will never match; it becomes an UnrecognizedItem row. */
export interface UnrecognizedImport {
  recognizedItemId: number;
  rawTitle: string;
  rawPlatform: string | null;
  reason: string;
}

/** A title whose external lookup failed transiently; it stays pending. */
export interface TransientImport {
  recognizedItemId: number;
  reason: string;
}

/** Everything one batch resolved, committed in a single transaction. */
export interface ImportBatchOutcome {
  resolved: ResolvedImport[];
  unrecognized: UnrecognizedImport[];
  transient: TransientImport[];
}

/** The persisted job columns the read API needs to build a response model. */
interface ImportJobRow {
  id: number;
  status: string;
  declaredCount: number | null;
  photoRef: string | null;
  batchId: string | null;
  bullJobId: string | null;
  recognizedCount: number;
  importedCount: number;
  unrecognizedCount: number;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

/** The four counts the read API exposes per job (ticket 3.6). */
export interface JobProgressCounts {
  recognizedCount: number;
  importedCount: number;
  unrecognizedCount: number;
  pendingCount: number;
}

@Injectable()
export class ImportJobsService {
  private readonly logger = new Logger(ImportJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(PHOTO_IMPORT_QUEUE)
    private readonly queue: Queue<PhotoImportJobData>,
    private readonly queueControl: QueueControlService,
  ) {}

  // ---------- read API ----------

  /** Newest first: createdAt DESC, id DESC tiebreaker (deterministic). */
  async list(
    query: ListImportJobsQueryDto,
  ): Promise<ListImportJobsResponseModel> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ImportJobWhereInput = {};
    if (query.status !== undefined) {
      where.status = query.status;
    }
    if (query.batchId !== undefined) {
      where.batchId = query.batchId;
    }
    const [items, total] = await Promise.all([
      this.prisma.importJob.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.importJob.count({ where }),
    ]);
    const counts = await this.progressCountsFor(items);
    // Terminal rows are never fetched from Redis (decision D4): their durable
    // status is the record and `queueState` stays null.
    const queueStates = await this.readQueueStates(
      items
        .filter((row) => !isTerminalImportJobStatus(row.status))
        .map((row) => row.bullJobId),
    );
    const mapped = items.map((row) =>
      this.toJobModel(
        row,
        counts.get(row.id) ?? emptyCounts(),
        queueStates.get(row.bullJobId ?? '') ?? null,
      ),
    );
    return {
      items: mapped,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Full trace: job + ALL unrecognized items (dismissed included), id ASC. */
  async findOne(id: number): Promise<ImportJobDetailModel> {
    const job = await this.prisma.importJob.findUnique({
      where: { id },
      include: { unrecognizedItems: { orderBy: { id: 'asc' } } },
    });
    if (!job) {
      throw new NotFoundException(`Import job with id ${String(id)} not found`);
    }
    const counts = await this.progressCountsFor([job]);
    const queueStates = isTerminalImportJobStatus(job.status)
      ? new Map<string, string>()
      : await this.readQueueStates([job.bullJobId]);
    return Object.assign(
      this.toJobModel(
        job,
        counts.get(job.id) ?? emptyCounts(),
        queueStates.get(job.bullJobId ?? '') ?? null,
      ),
      { unrecognizedItems: job.unrecognizedItems },
    );
  }

  /**
   * Review queue: only non-dismissed items (assumption A2 — this endpoint is
   * the flagged-item review, spec §5 "dismiss"). 404 for an unknown job.
   */
  async listUnrecognized(jobId: number): Promise<UnrecognizedItemModel[]> {
    await this.assertJobExists(jobId);
    return this.prisma.unrecognizedItem.findMany({
      where: { importJobId: jobId, dismissedAt: null },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Aggregate progress for one upload batch (ticket 3.6): the X-of-Y view.
   * One `groupBy(status)` over the durable rows; 404 when the batch has no
   * rows at all (a typo/unknown id, not an empty-but-valid batch).
   */
  async getBatchProgress(batchId: string): Promise<ImportBatchProgressModel> {
    const groups = await this.prisma.importJob.groupBy({
      by: ['status'],
      where: { batchId },
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const group of groups) {
      byStatus[group.status] = group._count._all;
      total += group._count._all;
    }
    if (total === 0) {
      throw new NotFoundException(`Import batch ${batchId} not found`);
    }
    const queued = byStatus.queued ?? 0;
    const processing = byStatus.processing ?? 0;
    const pendingCount = queued + processing;
    const pause = await this.queueControl.getState();
    return {
      batchId,
      total,
      queued,
      processing,
      done: byStatus.done ?? 0,
      needsAttention: byStatus.needs_attention ?? 0,
      failed: byStatus.failed ?? 0,
      dismissed: byStatus.dismissed ?? 0,
      completedCount: total - pendingCount,
      pendingCount,
      allCompleted: pendingCount === 0,
      paused: pause.paused,
      pauseReason: pause.reason,
      pauseSource: pause.source,
    };
  }

  // ---------- user actions ----------

  /**
   * Dismiss a needs-attention/failed job (spec §4.2.4 "Dismissed").
   * Idempotent: dismissing an already-dismissed job is a 200 no-op.
   * Anything else (queued/processing/done) → 409. Dismissal is sticky:
   * no code path ever transitions a dismissed job back (the pipeline
   * refuses terminal jobs, see markCompleted/markFailed).
   */
  async dismissJob(id: number): Promise<ImportJobDetailModel> {
    const job = await this.prisma.importJob.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!job) {
      throw new NotFoundException(`Import job with id ${String(id)} not found`);
    }
    if (job.status === 'dismissed') {
      return this.findOne(id);
    }
    if (job.status !== 'needs_attention' && job.status !== 'failed') {
      throw new ConflictException(
        `Only needs-attention or failed jobs can be dismissed (current status: ${job.status})`,
      );
    }
    try {
      await this.prisma.importJob.update({
        where: { id },
        data: { status: 'dismissed' },
      });
    } catch (error) {
      if (this.isRecordNotFound(error)) {
        throw new NotFoundException(
          `Import job with id ${String(id)} not found`,
        );
      }
      throw error;
    }
    return this.findOne(id);
  }

  /**
   * Dismiss one flagged item; idempotent (re-dismissing is a 200 no-op).
   * 404 if the item is missing or belongs to another job.
   */
  async dismissUnrecognizedItem(
    jobId: number,
    itemId: number,
  ): Promise<UnrecognizedItemModel> {
    const item = await this.prisma.unrecognizedItem.findUnique({
      where: { id: itemId },
      select: { id: true, importJobId: true, dismissedAt: true },
    });
    if (item?.importJobId !== jobId) {
      throw new NotFoundException(
        `Unrecognized item with id ${String(itemId)} not found in import job ${String(jobId)}`,
      );
    }
    if (item.dismissedAt === null) {
      try {
        await this.prisma.unrecognizedItem.update({
          where: { id: itemId },
          data: { dismissedAt: new Date() },
        });
      } catch (error) {
        if (this.isRecordNotFound(error)) {
          throw new NotFoundException(
            `Unrecognized item with id ${String(itemId)} not found`,
          );
        }
        throw error;
      }
    }
    const updated = await this.prisma.unrecognizedItem.findUnique({
      where: { id: itemId },
    });
    if (!updated) {
      throw new NotFoundException(
        `Unrecognized item with id ${String(itemId)} not found`,
      );
    }
    return updated;
  }

  /**
   * Retry a failed run **in place** (ticket 3.6): the same `import_jobs` row
   * is reset to `queued` and a NEW BullMQ unit re-enters the pipeline.
   *
   * Idempotency comes from the pipeline itself: `visionCompletedAt` prevents a
   * second vision call, `listPendingRecognizedItems` re-runs only `pending`
   * titles, and the `updateMany({ status: 'pending' })` claim in
   * `commitImportBatch` rolls a batch back instead of duplicating a `Game`.
   * The counters are intentionally left intact — the pipeline recomputes them.
   *
   * Only `failed` jobs with a stored photo are retryable: `queued`/`processing`
   * are already in flight, and `done`/`needs_attention`/`dismissed` have
   * nothing pending. The guarded `updateMany` closes the race between two
   * concurrent retries.
   */
  async retryJob(id: number): Promise<ImportJobDetailModel> {
    const job = await this.prisma.importJob.findUnique({
      where: { id },
      select: { id: true, status: true, photoRef: true, declaredCount: true },
    });
    if (!job) {
      throw new NotFoundException(`Import job with id ${String(id)} not found`);
    }
    if (job.status !== 'failed') {
      throw new ConflictException(
        `Only failed jobs can be retried (current status: ${job.status})`,
      );
    }
    if (job.photoRef === null) {
      throw new ConflictException('This import has no photo to re-process');
    }
    const reset = await this.prisma.importJob.updateMany({
      where: { id, status: 'failed', photoRef: { not: null } },
      data: {
        status: 'queued',
        errorMessage: null,
        completedAt: null,
        // Re-anchor the sweep: this run is active again, so it must not be
        // treated as an abandonment merely because `createdAt` is old.
        enqueuedAt: new Date(),
      },
    });
    if (reset.count !== 1) {
      // Distinguish "photo swept" from "another writer moved the row" so the UI
      // can tell the user why a once-retryable job is no longer retryable.
      const current = await this.prisma.importJob.findUnique({
        where: { id },
        select: { status: true, photoRef: true },
      });
      if (current?.status === 'failed' && current.photoRef === null) {
        throw new ConflictException('This import has no photo to re-process');
      }
      throw new ConflictException(
        `Import job ${String(id)} is no longer failed`,
      );
    }
    let bullJobId: string;
    try {
      const bull = await this.queue.add('photo', {
        photoRef: job.photoRef,
        declaredCount: job.declaredCount,
        importJobId: id,
      });
      bullJobId = String(bull.id);
    } catch {
      // Secondary failure (the row may already have moved on): the intended
      // outcome is still the 503 below, so a failed markFailed must not turn
      // this into a 500.
      try {
        await this.markFailed(id, 'Failed to enqueue the import job');
      } catch (error) {
        this.logger.warn(
          `Failed to mark import job ${String(id)} failed after an enqueue error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      throw new ServiceUnavailableException(
        'Could not enqueue the import retry; please retry',
      );
    }
    // Best-effort, separate from the fatal enqueue above: the BullMQ unit is
    // already committed, so a failed id write only loses the live-state link
    // and must not force the row back to `failed` or return a 503.
    try {
      await this.prisma.importJob.update({
        where: { id },
        data: { bullJobId },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to store BullMQ id for import job ${String(id)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return this.findOne(id);
  }

  /**
   * Resume the paused photo-import queue (ticket 3.10) and clear the stored
   * reason. Idempotent: resuming an already-running queue is a 200 no-op.
   */
  async resumeQueue(): Promise<ImportQueueStateModel> {
    await this.queueControl.resume();
    const state = await this.queueControl.getState();
    return {
      paused: state.paused,
      reason: state.reason,
      source: state.source,
      pausedAt: state.pausedAt,
    };
  }

  // ---------- pipeline surface (called by tickets 3.2 / 3.5) ----------

  /** One row per uploaded photo (ticket 3.2); grouped by `batchId` (3.6). */
  async createJob(data: {
    declaredCount?: number | null;
    photoRef?: string | null;
    batchId?: string | null;
  }): Promise<ImportJobRow> {
    return this.prisma.importJob.create({
      data: {
        status: 'queued',
        declaredCount: data.declaredCount ?? null,
        photoRef: data.photoRef ?? null,
        batchId: data.batchId ?? null,
        // The sweep's abandonment anchor (ticket 3.8): a fresh run is active.
        enqueuedAt: new Date(),
      },
    });
  }

  /**
   * Stores the BullMQ job id currently backing this run (ticket 3.6), so the
   * read API can fetch its live queue state. Best-effort: the caller treats a
   * failure here as non-fatal (the durable row is already the record).
   */
  async setBullJobId(jobId: number, bullJobId: string): Promise<void> {
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { bullJobId },
    });
  }

  /**
   * queued|processing -> processing (idempotent on processing: a BullMQ
   * retry re-enters the processor without clobbering state).
   */
  async markProcessing(jobId: number): Promise<void> {
    await this.assertTransition(jobId, ['queued', 'processing']);
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { status: 'processing', enqueuedAt: new Date() },
    });
  }

  /**
   * queued|processing -> done | needs_attention.
   * Persists exactly the reported counts (acceptance: "match what the job
   * reported") and stamps completedAt. The needs-attention triggers are
   * spec §4.2.4: zero recognized items, a declared-count mismatch, or any
   * flagged item. Terminal job → 409 (a late callback can never clobber a
   * user dismissal — acceptance "stays dismissed").
   */
  async markCompleted(
    jobId: number,
    result: JobCompletionResult,
  ): Promise<ImportJobRow> {
    const job = await this.getJobForTransition(jobId, ['queued', 'processing']);
    const needsAttention =
      result.recognizedCount === 0 ||
      (job.declaredCount !== null &&
        result.recognizedCount !== job.declaredCount) ||
      result.unrecognizedCount > 0;
    // Conditional write: a read-then-unconditional `update` would clobber a
    // `failed` marking committed by a racing abandoned attempt (see
    // `markFailed`). Only an active row may transition.
    const written = await this.prisma.importJob.updateMany({
      where: { id: jobId, status: { in: ['queued', 'processing'] } },
      data: {
        status: needsAttention ? 'needs_attention' : 'done',
        recognizedCount: result.recognizedCount,
        importedCount: result.importedCount,
        unrecognizedCount: result.unrecognizedCount,
        completedAt: new Date(),
      },
    });
    if (written.count === 0) {
      throw new ConflictException(
        `Import job ${String(jobId)} is no longer active; refusing to overwrite a terminal result`,
      );
    }
    return this.reloadJobRow(jobId);
  }

  /**
   * queued|processing -> failed, with the reason shown to the UI (spec §4.2.7).
   *
   * `counts` carries the counters already reached before the failure (the
   * pipeline computes them with `summarizeRecognizedItems`), so a permanently
   * failed run still reports whatever it imported instead of leaving every
   * counter column at 0. It is optional because a caller with no partial work
   * (e.g. a job that never got past `queued`) has nothing to persist.
   */
  async markFailed(
    jobId: number,
    errorMessage: string,
    counts?: JobCompletionResult,
  ): Promise<ImportJobRow> {
    await this.assertTransition(jobId, ['queued', 'processing']);
    // Conditional write: only an active row may transition to `failed`, so a
    // late `markCompleted` cannot clobber this failure marking and vice versa.
    const written = await this.prisma.importJob.updateMany({
      where: { id: jobId, status: { in: ['queued', 'processing'] } },
      data: {
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
        ...(counts
          ? {
              recognizedCount: counts.recognizedCount,
              importedCount: counts.importedCount,
              unrecognizedCount: counts.unrecognizedCount,
            }
          : {}),
      },
    });
    if (written.count === 0) {
      throw new ConflictException(
        `Import job ${String(jobId)} is no longer active; refusing to overwrite a terminal result`,
      );
    }
    return this.reloadJobRow(jobId);
  }

  /** Incremental trace write per flagged item (ADR-002 retry semantics). */
  async addUnrecognizedItem(
    jobId: number,
    data: {
      rawTitle: string;
      rawPlatform?: string | null;
      reason?: string | null;
    },
  ): Promise<UnrecognizedItemModel> {
    await this.assertJobExists(jobId);
    return this.prisma.unrecognizedItem.create({
      data: {
        importJobId: jobId,
        rawTitle: data.rawTitle,
        rawPlatform: data.rawPlatform ?? null,
        reason: data.reason ?? null,
      },
    });
  }

  // ---------- pipeline state (ticket 3.5) ----------

  /** The pipeline's job snapshot, or `null` for an unknown id. */
  async getPipelineJob(jobId: number): Promise<PipelineJobState | null> {
    return this.prisma.importJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        declaredCount: true,
        photoRef: true,
        visionCompletedAt: true,
        recognizedCount: true,
        importedCount: true,
        unrecognizedCount: true,
      },
    });
  }

  /** Resolves the legacy (no `importJobId` in the payload) photoRef path. */
  async findJobIdByPhotoRef(photoRef: string): Promise<number | null> {
    const job = await this.prisma.importJob.findFirst({
      where: { photoRef },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return job?.id ?? null;
  }

  /**
   * Newest import_jobs row per photoRef, for the photo sweep (ticket 3.8).
   * One query per sweep batch (no N+1). photoRef is a UUID set by
   * PhotoStorageService.store, so at most one live row owns a file; the `id asc`
   * order lets the newest id win.
   */
  async findPhotoOwners(
    photoRefs: string[],
  ): Promise<Map<string, PhotoSweepOwner>> {
    const owners = new Map<string, PhotoSweepOwner>();
    if (photoRefs.length === 0) return owners;
    const rows = await this.prisma.importJob.findMany({
      where: { photoRef: { in: photoRefs } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        photoRef: true,
        status: true,
        createdAt: true,
        enqueuedAt: true,
        completedAt: true,
      },
    });
    for (const row of rows) {
      if (row.photoRef === null) continue;
      owners.set(row.photoRef, {
        id: row.id,
        status: row.status,
        createdAt: row.createdAt,
        enqueuedAt: row.enqueuedAt,
        completedAt: row.completedAt,
      });
    }
    return owners;
  }

  /**
   * Atomically releases one swept photo (ticket 3.8): clears `photoRef` and,
   * for an abandoned non-terminal job, marks it `failed` with a reason. The
   * guarded `updateMany` (id + photoRef + the status the sweep saw) closes the
   * race with `retryJob`: whichever write lands first wins, and the loser skips
   * the file delete. Returns true when this call claimed the row.
   */
  async releaseSweptPhoto(
    jobId: number,
    photoRef: string,
    expectedStatus: string,
    markFailedReason?: string,
  ): Promise<boolean> {
    const written = await this.prisma.importJob.updateMany({
      where: { id: jobId, photoRef, status: expectedStatus },
      data:
        markFailedReason === undefined
          ? { photoRef: null }
          : {
              photoRef: null,
              status: 'failed',
              errorMessage: markFailedReason,
              completedAt: new Date(),
            },
    });
    return written.count === 1;
  }

  /**
   * Persists the single vision result and its marker in one transaction.
   *
   * The `visionCompletedAt: null` guard makes this a one-time write: a retry
   * (or a duplicate call) sees the marker already set and writes nothing, so
   * the vision call is never repeated (acceptance criterion). Returns the
   * number of rows written (0 when recognition was already persisted).
   */
  async saveRecognition(
    jobId: number,
    items: RecognitionItemInput[],
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const marker = await tx.importJob.updateMany({
        where: { id: jobId, visionCompletedAt: null },
        data: { visionCompletedAt: new Date() },
      });
      if (marker.count !== 1) {
        return 0;
      }
      if (items.length > 0) {
        await tx.recognizedItem.createMany({
          data: items.map((item, position) => ({
            importJobId: jobId,
            position,
            rawTitle: item.title,
            rawEdition: item.edition,
            rawPlatform: item.platform,
            confidence: item.confidence,
            status: 'pending',
          })),
          skipDuplicates: true,
        });
      }
      return items.length;
    });
  }

  /** Unresolved titles for this job, in recognition order (retry re-entry). */
  async listPendingRecognizedItems(
    jobId: number,
  ): Promise<PipelineRecognizedItem[]> {
    return this.prisma.recognizedItem.findMany({
      where: { importJobId: jobId, status: 'pending' },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        position: true,
        rawTitle: true,
        rawEdition: true,
        rawPlatform: true,
        confidence: true,
        status: true,
      },
    });
  }

  /** Counts by per-item status; `status: 'pending'` implies an incomplete run. */
  async summarizeRecognizedItems(jobId: number): Promise<JobCompletionResult> {
    const groups = await this.prisma.recognizedItem.groupBy({
      by: ['status'],
      where: { importJobId: jobId },
      _count: { _all: true },
    });
    let recognizedCount = 0;
    let importedCount = 0;
    let unrecognizedCount = 0;
    for (const group of groups) {
      const count = group._count._all;
      recognizedCount += count;
      if (group.status === 'imported') {
        importedCount += count;
      } else if (group.status === 'unrecognized') {
        unrecognizedCount += count;
      }
    }
    return { recognizedCount, importedCount, unrecognizedCount };
  }

  /**
   * Maps a resolved candidate onto a `Platform` row. IGDB id first (the
   * canonical link), then anchored equality matching over the candidate's
   * name/abbreviation and the raw platform string against every platform's
   * name/abbreviation/alternative name (case-, diacritic-, punctuation-, and
   * whitespace-insensitive). One DB query per call and **zero** IGDB
   * platform-list requests: per-game imports never create platforms or fetch
   * the list. Returns `null` when nothing matches — the caller flags the item
   * rather than guessing.
   */
  async resolvePlatformId(
    candidatePlatforms: CatalogPlatform[],
    rawPlatform: string | null,
  ): Promise<number | null> {
    const platforms = await this.prisma.platform.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        abbreviation: true,
        alternativeName: true,
        igdbId: true,
      },
    });
    const igdbIds = candidatePlatforms
      .map((platform) => platform.igdbId)
      .filter((id): id is number => id !== null);
    if (igdbIds.length > 0) {
      const byIgdbId = platforms.find(
        (platform) =>
          platform.igdbId !== null && igdbIds.includes(platform.igdbId),
      );
      if (byIgdbId) {
        return byIgdbId.id;
      }
    }
    const match = findPlatformMatch(platforms, [
      ...candidatePlatforms.flatMap((platform) => [
        platform.name,
        platform.abbreviation,
      ]),
      rawPlatform ?? '',
    ]);
    return match?.id ?? null;
  }

  /**
   * Commits one batch in a single MySQL transaction (never one tx per job).
   *
   * Before writing anything it rejects a job that is already terminal
   * (`failed`/`done`/`needs_attention`), so an abandoned attempt cannot mutate
   * the catalog after `markFailed`/`markCompleted`.
   *
   * Matched titles create a `Game` and claim their recognized item via an
   * `updateMany({ status: 'pending' })`; a zero-row claim throws so the whole
   * batch rolls back — a retry can therefore never duplicate a catalog row.
   * Flagged titles use the **same** guarded claim before creating their
   * `UnrecognizedItem`, so a duplicate/late processing of an already-flagged
   * item also rolls back instead of writing a second trace row. Both zero-row
   * claims are a benign race (another attempt already resolved the item) and
   * are thrown as `RetryableImportError`, so they schedule a retry rather than
   * permanently failing a job that is actually succeeding.
   */
  async commitImportBatch(
    jobId: number,
    outcome: ImportBatchOutcome,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Terminal-status guard: a job already `failed`/`done`/`needs_attention`
      // (e.g. marked by the timeout path while an abandoned attempt is still
      // running) must stop mutating items and the catalog.
      const job = await tx.importJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (job && isTerminalImportJobStatus(job.status)) {
        throw new RetryableImportError(
          `Import job ${String(jobId)} is already ${job.status}; refusing to commit a batch`,
        );
      }
      for (const item of outcome.resolved) {
        const game = await tx.game.create({
          data: {
            title: item.candidate.title,
            platformId: item.platformId,
            edition: item.edition,
            releaseYear: item.candidate.releaseYear,
            publisher: item.candidate.publisher,
            genre: item.candidate.genre,
            coverUrl: item.candidate.coverUrl,
            rawMetadata: JSON.stringify(item.candidate.raw),
            enrichedAt: new Date(),
            source: item.candidate.source,
          },
        });
        const claim = await tx.recognizedItem.updateMany({
          where: {
            id: item.recognizedItemId,
            importJobId: jobId,
            status: 'pending',
          },
          data: { status: 'imported', gameId: game.id },
        });
        if (claim.count === 0) {
          // A concurrent/abandoned attempt already resolved this item: the
          // batch rolls back, but this is a benign race, not a permanent
          // failure — the retry re-queries only still-pending titles.
          throw new RetryableImportError(
            `Recognized item ${String(item.recognizedItemId)} was already resolved; rolling back the batch`,
          );
        }
      }
      for (const item of outcome.unrecognized) {
        const claim = await tx.recognizedItem.updateMany({
          where: {
            id: item.recognizedItemId,
            importJobId: jobId,
            status: 'pending',
          },
          data: { status: 'unrecognized', reason: item.reason },
        });
        if (claim.count === 0) {
          throw new RetryableImportError(
            `Recognized item ${String(item.recognizedItemId)} was already resolved; rolling back the batch`,
          );
        }
        await tx.unrecognizedItem.create({
          data: {
            importJobId: jobId,
            rawTitle: item.rawTitle,
            rawPlatform: item.rawPlatform,
            reason: item.reason,
          },
        });
      }
    });
  }

  // ---------- helpers ----------

  /**
   * Best-effort live BullMQ states for the given ids (ticket 3.6). A Redis
   * error or a slow response yields an empty map: the durable MySQL status is
   * the record, the queue state is only a supplementary signal.
   */
  async readQueueStates(
    bullJobIds: (string | null)[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(bullJobIds.filter((v): v is string => typeof v === 'string')),
    ];
    if (ids.length === 0) {
      return new Map();
    }
    try {
      const results = await this.withTimeout(
        Promise.allSettled(
          ids.map(async (bullId) => {
            const job = await this.queue.getJob(bullId);
            if (!job) return null;
            return [bullId, await job.getState()] as const;
          }),
        ),
        IMPORT_QUEUE_STATE_TIMEOUT_MS,
      );
      const states = new Map<string, string>();
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value !== null) {
          states.set(result.value[0], result.value[1]);
        }
      }
      return states;
    } catch {
      return new Map();
    }
  }

  /**
   * Live counts from `recognized_items` for a set of jobs, in one query.
   * `pending` is tracked separately so the read API can report unresolved
   * titles even before the job is terminal.
   */
  private async deriveCounts(
    ids: number[],
  ): Promise<Map<number, JobProgressCounts>> {
    const counts = new Map<number, JobProgressCounts>();
    for (const id of ids) {
      counts.set(id, emptyCounts());
    }
    if (ids.length === 0) {
      return counts;
    }
    const groups = await this.prisma.recognizedItem.groupBy({
      by: ['importJobId', 'status'],
      where: { importJobId: { in: ids } },
      _count: { _all: true },
    });
    for (const group of groups) {
      const entry = counts.get(group.importJobId) ?? emptyCounts();
      const count = group._count._all;
      entry.recognizedCount += count;
      if (group.status === 'imported') {
        entry.importedCount += count;
      } else if (group.status === 'unrecognized') {
        entry.unrecognizedCount += count;
      } else if (group.status === 'pending') {
        entry.pendingCount += count;
      }
      counts.set(group.importJobId, entry);
    }
    return counts;
  }

  /**
   * Counts per job: terminal rows use the persisted counters (the pipeline's
   * source of truth); non-terminal rows are computed live so a poller sees
   * progress while the run is still in flight. `pendingCount` is always
   * `max(0, recognized − imported − unrecognized)`.
   */
  private async progressCountsFor(
    rows: Pick<
      ImportJobRow,
      | 'id'
      | 'status'
      | 'recognizedCount'
      | 'importedCount'
      | 'unrecognizedCount'
    >[],
  ): Promise<Map<number, JobProgressCounts>> {
    const counts = new Map<number, JobProgressCounts>();
    const liveIds: number[] = [];
    for (const row of rows) {
      if (isTerminalImportJobStatus(row.status)) {
        counts.set(row.id, {
          recognizedCount: row.recognizedCount,
          importedCount: row.importedCount,
          unrecognizedCount: row.unrecognizedCount,
          pendingCount: Math.max(
            0,
            row.recognizedCount - row.importedCount - row.unrecognizedCount,
          ),
        });
      } else {
        liveIds.push(row.id);
      }
    }
    if (liveIds.length > 0) {
      const live = await this.deriveCounts(liveIds);
      for (const [id, entry] of live) {
        counts.set(id, entry);
      }
    }
    return counts;
  }

  /**
   * Builds the read model for one row: merges the durable status with the live
   * queue state, and derives the review flags from the counts.
   */
  private toJobModel(
    row: ImportJobRow,
    counts: JobProgressCounts,
    queueState: string | null,
  ): ImportJobModel {
    const status = mergeImportJobStatus(row.status, queueState);
    return {
      id: row.id,
      status,
      declaredCount: row.declaredCount,
      photoRef: row.photoRef,
      recognizedCount: counts.recognizedCount,
      importedCount: counts.importedCount,
      unrecognizedCount: counts.unrecognizedCount,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      batchId: row.batchId,
      bullJobId: row.bullJobId,
      pendingCount: counts.pendingCount,
      needsAttention: status === 'needs_attention',
      declaredCountMismatch:
        isTerminalImportJobStatus(row.status) &&
        row.declaredCount !== null &&
        counts.recognizedCount !== row.declaredCount,
      // Redis is never authoritative for a terminal outcome (decision D4).
      queueState: isTerminalImportJobStatus(row.status) ? null : queueState,
    };
  }

  /** Rejects after `timeoutMs`; clears the timer on settle (no dangling handle). */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Redis did not respond in time'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async assertJobExists(jobId: number): Promise<void> {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      select: { id: true },
    });
    if (!job) {
      throw new NotFoundException(
        `Import job with id ${String(jobId)} not found`,
      );
    }
  }

  /** Loads the job; 404 for unknown, 409 for a state not in `allowed`. */
  private async getJobForTransition(jobId: number, allowed: string[]) {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, declaredCount: true },
    });
    if (!job) {
      throw new NotFoundException(
        `Import job with id ${String(jobId)} not found`,
      );
    }
    if (!allowed.includes(job.status)) {
      throw new ConflictException(
        `Import job ${String(jobId)} is already ${job.status}; refusing to overwrite a terminal result`,
      );
    }
    return job;
  }

  private async assertTransition(
    jobId: number,
    allowed: string[],
  ): Promise<void> {
    await this.getJobForTransition(jobId, allowed);
  }

  /**
   * Re-reads a row after a guarded write. Both terminal transitions return the
   * persisted row so callers see the final status/counters; a vanished row is a
   * 404, matching the rest of the surface.
   */
  private async reloadJobRow(jobId: number): Promise<ImportJobRow> {
    const row = await this.prisma.importJob.findUnique({
      where: { id: jobId },
    });
    if (row === null) {
      throw new NotFoundException(
        `Import job with id ${String(jobId)} not found`,
      );
    }
    return row;
  }

  /** P2025 — row vanished between read and write (platforms.service pattern). */
  private isRecordNotFound(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }
}

/** A zeroed count set; used as the base for live aggregation. */
function emptyCounts(): JobProgressCounts {
  return {
    recognizedCount: 0,
    importedCount: 0,
    unrecognizedCount: 0,
    pendingCount: 0,
  };
}
