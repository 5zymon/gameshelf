import { BadRequestException } from '@nestjs/common';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

export const IMPORT_PHOTOS_DIR_ENV = 'IMPORT_PHOTOS_DIR';
export const DEFAULT_IMPORT_PHOTOS_DIR = join(
  tmpdir(),
  'gameshelf-import-photos',
);

export const UPLOAD_FIELD_NAME = 'files';
export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_DECLARED_COUNT = 1000;

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]);
export const MIME_EXTENSION: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * Multer fileFilter: reject non-JPEG/PNG/WebP with a clear 400.
 *
 * The callback type mirrors `@nestjs/platform-express`'s `MulterOptions`
 * (its `fileFilter` callback is `(error, acceptFile)`, not `@types/multer`'s
 * overloaded `FileFilterCallback`), so the constant is assignable to
 * `FilesInterceptor`'s options.
 */
export const imageFileFilter = (
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void => {
  const ext = extname(file.originalname).toLowerCase();
  if (
    !ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype) ||
    !ALLOWED_IMAGE_EXTENSIONS.has(ext)
  ) {
    callback(
      new BadRequestException(
        `Unsupported file "${file.originalname}": only JPEG, PNG, and WebP images are accepted`,
      ),
      false,
    );
    return;
  }
  callback(null, true);
};
