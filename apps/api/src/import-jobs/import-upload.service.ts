import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { PhotoImportJobData } from '../queue/photo-import.types';
import { PHOTO_IMPORT_QUEUE } from '../queue/queue.constants';
import { LlmSettingsService } from '../settings/llm-settings.service';
import type { StartImportUploadResponseModel } from './dto/import-upload-response.model';
import { ImportJobsService } from './import-jobs.service';
import {
  IMPORT_MAX_ATTEMPTS,
  IMPORT_RETRY_BACKOFF_MS,
} from './import-pipeline.options';
import { PhotoStorageService } from './photo-storage.service';
import { MAX_DECLARED_COUNT } from './upload.options';

/** Parses the optional index-aligned declared-count field. Exported for unit tests. */
export function parseDeclaredCounts(
  raw: string[] | undefined,
  fileCount: number,
): (number | null)[] {
  if (raw === undefined || raw.length === 0) {
    return Array.from({ length: fileCount }, () => null);
  }
  if (raw.length > fileCount) {
    throw new BadRequestException(
      `declaredCounts has ${String(raw.length)} entries but ${String(fileCount)} photos were uploaded`,
    );
  }
  return Array.from({ length: fileCount }, (_unused, index) => {
    const entry = raw[index];
    if (entry === undefined || entry.trim() === '') return null;
    const value = entry.trim();
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(
        `declaredCounts[${String(index)}] must be a positive integer or empty`,
      );
    }
    const count = Number(value);
    if (count < 1 || count > MAX_DECLARED_COUNT) {
      throw new BadRequestException(
        `declaredCounts[${String(index)}] must be between 1 and ${String(MAX_DECLARED_COUNT)}`,
      );
    }
    return count;
  });
}

/**
 * Accepts a multi-photo upload and returns immediately: every photo is written
 * to ephemeral storage, gets one `queued` `ImportJob` row, and is enqueued as
 * one BullMQ `'photo'` job. No recognition/LLM work happens here.
 */
@Injectable()
export class ImportUploadService {
  constructor(
    private readonly jobs: ImportJobsService,
    private readonly storage: PhotoStorageService,
    private readonly settings: LlmSettingsService,
    @InjectQueue(PHOTO_IMPORT_QUEUE)
    private readonly queue: Queue<PhotoImportJobData>,
  ) {}

  async startUpload(
    files: Express.Multer.File[],
    declaredCounts: string[] | undefined,
  ): Promise<StartImportUploadResponseModel> {
    if (!(await this.settings.isConfigured())) {
      throw new ServiceUnavailableException(
        'Photo import is unavailable: no LLM provider API key is configured (set it in Settings or GEMINI_API_KEY/OPENAI_API_KEY)',
      );
    }
    if (files.length === 0) {
      throw new BadRequestException('At least one photo is required');
    }
    const counts = parseDeclaredCounts(declaredCounts, files.length);

    const jobs: StartImportUploadResponseModel['jobs'] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (file === undefined) continue;
      const declaredCount = counts[index] ?? null;
      const photoRef = await this.storage.store(file);
      const row = await this.jobs.createJob({ declaredCount, photoRef });
      try {
        const job = await this.queue.add(
          'photo',
          { photoRef, declaredCount, importJobId: row.id },
          {
            attempts: IMPORT_MAX_ATTEMPTS,
            backoff: {
              type: 'exponential',
              delay: IMPORT_RETRY_BACKOFF_MS,
            },
          },
        );
        jobs.push({
          id: row.id,
          jobId: String(job.id),
          status: row.status,
          declaredCount,
        });
      } catch {
        await this.jobs.markFailed(row.id, 'Failed to enqueue the import job');
        throw new ServiceUnavailableException(
          'Could not enqueue the photo import; please retry',
        );
      }
    }
    return { jobs };
  }
}
