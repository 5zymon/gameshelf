import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** Env var overriding the on-disk cover cache location. */
export const COVERS_DIR_ENV = 'COVERS_DIR';

/** Name of the default cover cache directory, inside the repository. */
export const COVERS_DIR_NAME = 'covers';

/**
 * The monorepo root: the nearest ancestor of this file whose `package.json`
 * declares `workspaces`. Relative `COVERS_DIR` values are resolved against it
 * rather than the per-workspace cwd (`apps/api`), so the API, the CLI commands
 * and the test run all share one cache directory.
 */
export const REPO_ROOT = findRepoRoot(__dirname) ?? process.cwd();

/**
 * Default cover cache directory: the git-ignored `covers/` in the repository
 * root, next to `data/` and `backups/`.
 */
export const DEFAULT_COVERS_DIR = join(REPO_ROOT, COVERS_DIR_NAME);

/**
 * Cache directory for a raw `COVERS_DIR` value: blank/absent falls back to the
 * default, an absolute path is used as-is, and a relative path is resolved
 * against the repository root.
 */
export function resolveCoversDir(raw: string | undefined | null): string {
  const value = raw?.trim() ?? '';
  if (value === '') {
    return DEFAULT_COVERS_DIR;
  }
  return isAbsolute(value) ? value : resolve(REPO_ROOT, value);
}

/** Same-origin prefix the cache is served under (the web app rewrites `/api`). */
export const COVER_URL_PREFIX = '/api/covers';

/** Hard per-request timeout for a cover download. */
export const COVER_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Maximum number of HTTP redirects a cover download follows. Redirects are
 * followed manually so every target host can be checked against the allowlist
 * *before* a connection is made; exceeding this cap aborts the download.
 */
export const MAX_COVER_REDIRECTS = 5;

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

/** Same-origin prefix generated thumbnails are served under. */
export const COVER_THUMB_URL_PREFIX = '/api/covers/thumbs';

/** Same-origin path of the server-side cover preview passthrough. */
export const COVER_PREVIEW_PATH = '/api/covers/preview';

/** Catalog thumbnail width in pixels (height follows the aspect ratio). */
export const COVER_THUMBNAIL_WIDTH = 300;

/** Stored thumbnail file extension / content type (always WebP). */
export const COVER_THUMBNAIL_EXTENSION = '.webp';
export const COVER_THUMBNAIL_MIME_TYPE = 'image/webp';

/** How long a browser may cache a preview passthrough response (24 h). */
export const COVER_PREVIEW_CACHE_MAX_AGE_SECONDS = 86_400;

/** How long a signed preview URL stays valid (24 h, matching the cache). */
export const COVER_PREVIEW_TTL_SECONDS = 86_400;

/** Env var overriding the comma-separated cover host allowlist. */
export const COVER_PREVIEW_HOSTS_ENV = 'COVER_PREVIEW_HOSTS';

/** Env var overriding the preview URL signing secret (falls back to session). */
export const COVER_PREVIEW_SECRET_ENV = 'COVER_PREVIEW_SECRET';

/** Hosts a preview may fetch from when `COVER_PREVIEW_HOSTS` is unset. */
export const DEFAULT_COVER_PREVIEW_HOSTS: readonly string[] = [
  'images.igdb.com',
  'www.mobygames.com',
  'mobygames.com',
];

/** Default interval between background cover-retry sweeps (15 min). */
const DEFAULT_COVER_RETRY_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Interval between background cover-retry sweeps, overridable with the
 * `COVER_RETRY_SWEEP_INTERVAL_MS` environment variable. Read at module load
 * (the `@Interval` decorator needs a static value); a non-positive or
 * non-numeric override falls back to the default.
 */
export const COVER_RETRY_SWEEP_INTERVAL_MS = readPositiveIntEnv(
  'COVER_RETRY_SWEEP_INTERVAL_MS',
  DEFAULT_COVER_RETRY_SWEEP_INTERVAL_MS,
);

/** Upper bound on games retried per background sweep / redownload page. */
export const COVER_RETRY_BATCH_SIZE = 50;

/**
 * Upper bound on the number of `COVER_RETRY_BATCH_SIZE` pages the background
 * sweep scans per run. The selection rotates across sweeps (see
 * `CoverRecoveryService.retryMissing`), so a page cap keeps each run bounded
 * without letting permanently-failing low-id rows starve later ones.
 */
export const COVER_RETRY_SWEEP_MAX_PAGES = 10;

/**
 * The single cover-download host allowlist, shared by the local cache (which
 * downloads user/catalog `coverUrl`s) and the signed preview passthrough. A
 * non-blank, comma-separated `raw` value replaces the built-in IGDB/MobyGames
 * hosts; blank/absent falls back to the defaults. Entries are lowercased and a
 * host also matches its subdomains.
 */
export function coverAllowedHosts(raw: string | undefined | null): string[] {
  if (raw !== undefined && raw !== null && raw.trim() !== '') {
    return raw
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host !== '');
  }
  return [...DEFAULT_COVER_PREVIEW_HOSTS];
}

/**
 * True when `hostname` equals, or is a subdomain of, an allowed cover host.
 * This is the one guard used before any outbound cover request (the cache, the
 * HTTP client, and the preview resolver), so no `coverUrl` can be fetched from
 * an arbitrary or private host.
 */
export function isAllowedCoverHost(
  hostname: string,
  raw: string | undefined | null,
): boolean {
  const host = hostname.trim().toLowerCase();
  if (host === '') {
    return false;
  }
  return coverAllowedHosts(raw).some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/**
 * Derives the same-origin thumbnail URL for a stored cover URL, or `null` when
 * there is no cover. Keeping the full `<hash>.<ext>` name lets the thumbnail
 * route fall back to the full cover when a thumbnail could not be generated.
 */
export function coverThumbUrlFor(
  coverUrl: string | null | undefined,
): string | null {
  const prefix = `${COVER_URL_PREFIX}/`;
  const safe = coverUrl ?? '';
  if (!safe.startsWith(prefix)) {
    return null;
  }
  return `${COVER_THUMB_URL_PREFIX}/${safe.slice(prefix.length)}`;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Walks up from `from` looking for the workspace root manifest. */
function findRepoRoot(from: string): string | null {
  let dir = from;
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && declaresWorkspaces(manifest)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/** True when the manifest at `path` is a workspace root (`workspaces` set). */
function declaresWorkspaces(path: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }
    const workspaces = (parsed as { workspaces?: unknown }).workspaces;
    return (
      (Array.isArray(workspaces) && workspaces.length > 0) ||
      (typeof workspaces === 'object' &&
        workspaces !== null &&
        Object.keys(workspaces).length > 0)
    );
  } catch {
    // An unreadable or malformed manifest is not the root marker.
    return false;
  }
}
