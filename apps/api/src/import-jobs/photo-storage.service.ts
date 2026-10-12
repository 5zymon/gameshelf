import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  DEFAULT_IMPORT_PHOTOS_DIR,
  DEFAULT_IMAGE_MIME_TYPE,
  EXTENSION_MIME,
  IMPORT_PHOTOS_DIR_ENV,
  MIME_EXTENSION,
} from './upload.options';

/**
 * Writes uploaded photos to an ephemeral directory (never a served gallery).
 * The returned value is the bare filename stored in `ImportJob.photoRef`; the
 * worker resolves it against the same directory (ADR-005: the worker shares
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

  /**
   * Reads a stored photo back for recognition. The mime type is derived from
   * the stored extension (which `store` set from the original mimetype).
   */
  async read(photoRef: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const buffer = await readFile(this.resolvePath(photoRef));
    const extension = extname(photoRef).toLowerCase();
    return {
      buffer,
      mimeType: EXTENSION_MIME[extension] ?? DEFAULT_IMAGE_MIME_TYPE,
    };
  }

  /**
   * Deletes a stored photo. `null` is a no-op (rows without a photo). Only a
   * missing file (ENOENT) is tolerated; any other error propagates so the
   * caller decides whether it is fatal (the pipeline logs and continues).
   */
  async delete(photoRef: string | null): Promise<void> {
    if (photoRef === null) {
      return;
    }
    try {
      await unlink(this.resolvePath(photoRef));
    } catch (error) {
      if (this.isEnoent(error)) {
        return;
      }
      throw error;
    }
  }

  /**
   * Existing bare filenames with their mtime, oldest first. The directory may
   * not exist yet (no upload since boot) — that is an empty list, not an error.
   * Vanished files and subdirectories are skipped.
   */
  async list(): Promise<{ name: string; mtimeMs: number }[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if (this.isEnoent(error)) return [];
      throw error;
    }
    const files: { name: string; mtimeMs: number }[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        const stats = await stat(join(this.directory, entry.name));
        files.push({ name: entry.name, mtimeMs: stats.mtimeMs });
      } catch (error) {
        if (this.isEnoent(error)) continue;
        throw error;
      }
    }
    return files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  }

  private resolvePath(photoRef: string): string {
    return join(this.directory, photoRef);
  }

  private isEnoent(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    );
  }
}
