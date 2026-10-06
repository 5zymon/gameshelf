import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

  /** queued|processing -> failed, with the reason shown to the UI (spec §4.2.7). */
  async markFailed(
    jobId: number,
    errorMessage: string,
  ): Promise<ImportJobModel> {
    await this.assertTransition(jobId, ['queued', 'processing']);
    return this.prisma.importJob.update({
      where: { id: jobId },
      data: { status: 'failed', errorMessage, completedAt: new Date() },
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
