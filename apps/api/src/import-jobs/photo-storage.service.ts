import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_IMPORT_PHOTOS_DIR,
  IMPORT_PHOTOS_DIR_ENV,
  MIME_EXTENSION,
} from './upload.options';

/**
 * Writes uploaded photos to an ephemeral directory (never a served gallery).
 * The returned value is the bare filename stored in `ImportJob.photoRef`; the
 * worker resolves it against the same directory (ADR-002: the worker shares
 * the API's local filesystem).
 */
@Injectable()
export class PhotoStorageService {
  constructor(private readonly config: ConfigService) {}

  /** Configured ephemeral directory; blank/absent falls back to the default. */
  get directory(): string {
    const raw = this.config.get<string>(IMPORT_PHOTOS_DIR_ENV);
    return raw !== undefined && raw.trim() !== ''
      ? raw.trim()
      : DEFAULT_IMPORT_PHOTOS_DIR;
  }

  async store(file: Express.Multer.File): Promise<string> {
    const dir = this.directory;
    await mkdir(dir, { recursive: true });
    const extension = MIME_EXTENSION[file.mimetype] ?? '';
    const filename = `${randomUUID()}${extension}`;
    await writeFile(join(dir, filename), file.buffer);
    return filename;
  }
}
