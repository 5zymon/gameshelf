import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LlmSettingsService } from '../settings/llm-settings.service';
import type { StartImportUploadResponseModel } from './dto/import-upload-response.model';
import { ImportJobsService } from './import-jobs.service';
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
 * to ephemeral storage and gets one `queued`, immediately runnable `ImportJob`
 * row (the row is the queue entry, ADR-005), which wakes the in-process worker.
 * No recognition/LLM work happens here.
 */
@Injectable()
export class ImportUploadService {
  constructor(
    private readonly jobs: ImportJobsService,
    private readonly storage: PhotoStorageService,
    private readonly settings: LlmSettingsService,
  ) {}

  async startUpload(
    files: Express.Multer.File[],
    declaredCounts: string[] | undefined,
  ): Promise<StartImportUploadResponseModel> {
    if (!(await this.settings.isConfigured())) {
      throw new ServiceUnavailableException(
        'Photo import is unavailable: game recognition is not configured (set the base URL and API key in Settings)',
      );
    }
    if (files.length === 0) {
      throw new BadRequestException('At least one photo is required');
    }
    const counts = parseDeclaredCounts(declaredCounts, files.length);

    // One batch id groups every photo in this request (ticket 3.6), so the
    // aggregate progress view can report X of Y across the whole upload.
    const batchId = randomUUID();
    const jobs: StartImportUploadResponseModel['jobs'] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (file === undefined) continue;
      const declaredCount = counts[index] ?? null;
      const photoRef = await this.storage.store(file);
      const row = await this.jobs.createJob({
        declaredCount,
        photoRef,
        batchId,
        enqueue: true,
      });
      jobs.push({
        id: row.id,
        jobId: String(row.id),
        status: row.status,
        declaredCount,
      });
    }
    return { batchId, jobs };
  }
}
