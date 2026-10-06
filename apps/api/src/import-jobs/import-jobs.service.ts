import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CatalogCandidate,
  CatalogPlatform,
} from '../game-catalog/game-catalog.resolver';
import { ListImportJobsQueryDto } from './dto/list-import-jobs-query.dto';
import {
  ImportJobDetailModel,
  ImportJobModel,
  ListImportJobsResponseModel,
  UnrecognizedItemModel,
} from './dto/import-job-response.model';

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

@Injectable()
export class ImportJobsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const [items, total] = await Promise.all([
      this.prisma.importJob.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.importJob.count({ where }),
    ]);
    return {
      items,
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
    return job;
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

  // ---------- pipeline surface (called by tickets 3.2 / 3.5) ----------

  /** One row per uploaded photo (ticket 3.2). */
  async createJob(data: {
    declaredCount?: number | null;
    photoRef?: string | null;
  }): Promise<ImportJobModel> {
    return this.prisma.importJob.create({
      data: {
        status: 'queued',
        declaredCount: data.declaredCount ?? null,
        photoRef: data.photoRef ?? null,
      },
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
      data: { status: 'processing' },
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
  ): Promise<ImportJobModel> {
    const job = await this.getJobForTransition(jobId, ['queued', 'processing']);
    const needsAttention =
      result.recognizedCount === 0 ||
      (job.declaredCount !== null &&
        result.recognizedCount !== job.declaredCount) ||
      result.unrecognizedCount > 0;
    return this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: needsAttention ? 'needs_attention' : 'done',
        recognizedCount: result.recognizedCount,
        importedCount: result.importedCount,
        unrecognizedCount: result.unrecognizedCount,
        completedAt: new Date(),
      },
    });
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
  ): Promise<ImportJobModel> {
    await this.assertTransition(jobId, ['queued', 'processing']);
    return this.prisma.importJob.update({
      where: { id: jobId },
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
   * Maps a resolved candidate onto a seeded `Platform` row. IGDB id first
   * (the canonical link), then name/abbreviation/alternative-name (case
   * handled by the DB collation). Returns `null` when nothing matches — the
   * caller flags the item rather than guessing.
   */
  async resolvePlatformId(
    candidatePlatforms: CatalogPlatform[],
    rawPlatform: string | null,
  ): Promise<number | null> {
    const igdbIds = candidatePlatforms
      .map((platform) => platform.igdbId)
      .filter((id): id is number => id !== null);
    if (igdbIds.length > 0) {
      const byIgdbId = await this.prisma.platform.findFirst({
        where: { igdbId: { in: igdbIds } },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      if (byIgdbId) {
        return byIgdbId.id;
      }
    }
    const names = [
      ...candidatePlatforms.map((platform) => platform.name),
      rawPlatform ?? '',
    ]
      .map((name) => name.trim())
      .filter((name) => name !== '');
    for (const name of names) {
      const match = await this.prisma.platform.findFirst({
        where: {
          OR: [{ name }, { abbreviation: name }, { alternativeName: name }],
        },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      if (match) {
        return match.id;
      }
    }
    return null;
  }

  /**
   * Commits one batch in a single MySQL transaction (never one tx per job).
   *
   * Matched titles create a `Game` and claim their recognized item via an
   * `updateMany({ status: 'pending' })`; a zero-row claim throws so the whole
   * batch rolls back — a retry can therefore never duplicate a catalog row.
   * Flagged titles use the **same** guarded claim before creating their
   * `UnrecognizedItem`, so a duplicate/late processing of an already-flagged
   * item also rolls back instead of writing a second trace row.
   */
  async commitImportBatch(
    jobId: number,
    outcome: ImportBatchOutcome,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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
            source: 'IGDB',
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
          throw new Error(
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
          throw new Error(
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

  /** P2025 — row vanished between read and write (platforms.service pattern). */
  private isRecordNotFound(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }
}
