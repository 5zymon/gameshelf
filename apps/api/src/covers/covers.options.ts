import { homedir } from 'node:os';
import { join } from 'node:path';

/** Env var overriding the on-disk cover cache location. */
export const COVERS_DIR_ENV = 'COVERS_DIR';

/** Default cover cache directory (a durable, user-writable location). */
export const DEFAULT_COVERS_DIR = join(homedir(), '.gameshelf', 'covers');

/** Same-origin prefix the cache is served under (the web app rewrites `/api`). */
export const COVER_URL_PREFIX = '/api/covers';

/** Hard per-request timeout for a cover download. */
export const COVER_REQUEST_TIMEOUT_MS = 10_000;

/** Refuse to cache a cover larger than this (5 MB). */
export const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** Accepted upstream content types → canonical stored extension. */
export const COVER_MIME_EXTENSION: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** Reverse of `COVER_MIME_EXTENSION`: stored-file extension → mime type. */
export const COVER_EXTENSION_MIME: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
