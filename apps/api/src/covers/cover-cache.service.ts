import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { CoverHttpClient } from './cover-http.client';
import { makeThumbnail } from './cover-thumbnail';
import {
  COVERS_DIR_ENV,
  COVER_EXTENSION_MIME,
  COVER_MIME_EXTENSION,
  COVER_PREVIEW_HOSTS_ENV,
  COVER_THUMBNAIL_EXTENSION,
  COVER_THUMBNAIL_MIME_TYPE,
  COVER_THUMB_URL_PREFIX,
  COVER_URL_PREFIX,
  MAX_COVER_BYTES,
  isAllowedCoverHost,
  resolveCoversDir,
} from './covers.options';

/** A stored cover file plus the content type inferred from its extension. */
export interface CachedCover {
  buffer: Buffer;
  mimeType: string;
}

/** The only filenames `read` serves: a 32-hex hash and a known extension. */
const SAFE_COVER_FILE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

/** The only thumbnail filenames `readThumbnail` serves. */
const SAFE_THUMB_FILE = /^[a-f0-9]{32}\.thumb\.webp$/;

/** URL path extensions treated as cover hints (`.jpeg` normalizes to `.jpg`). */
const URL_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * The minimum local cover cache. A resolved candidate's external `coverUrl` is
 * downloaded once and stored under a deterministic name so the saved game's
 * `coverUrl` is a same-origin path (`/api/covers/<hex>.<ext>`) served by
 * `CoversController` — never an external host.
 *
 * The service deliberately never throws to its caller: any download/fs failure
 * degrades to `null`, so a broken cover can never fail an import item.
 */
@Injectable()
export class CoverCacheService {
  private readonly logger = new Logger(CoverCacheService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: CoverHttpClient,
  ) {}

  /** Configured cache directory; blank/absent falls back to the default. */
  get directory(): string {
    return resolveCoversDir(this.config.get<string>(COVERS_DIR_ENV));
  }

  /** Same-origin URL a cached file is served at. */
  servedUrl(name: string): string {
    return `${COVER_URL_PREFIX}/${name}`;
  }

  /** Same-origin URL the generated thumbnail for `name` is served at. */
  servedThumbnailUrl(name: string): string {
    return `${COVER_THUMB_URL_PREFIX}/${name}`;
  }

  /**
   * Parses a served cover URL (`/api/covers/<file>`) back to its basename, or
   * `null` when it is not a same-origin cover path (so a caller can never be
   * tricked into unlinking an arbitrary file).
   */
  fileFromServedUrl(servedUrl: string): string | null {
    if (!servedUrl.startsWith(`${COVER_URL_PREFIX}/`)) {
      return null;
    }
    const name = servedUrl.slice(COVER_URL_PREFIX.length + 1);
    return SAFE_COVER_FILE.test(name) ? name : null;
  }

  /** True when a stored file with this basename exists. */
  async has(file: string): Promise<boolean> {
    if (file.includes('/') || file.includes('..')) {
      return false;
    }
    return this.exists(file);
  }

  /**
   * Downloads `url` into the cache and returns its served path, or `null` when
   * there is nothing to cache (no URL, non-HTTP scheme, a failed/oversize/
   * non-image response, or any error). A URL already cached is not re-fetched.
   */
  async cacheFromUrl(url: string | null): Promise<string | null> {
    if (url === null || url.trim() === '') {
      return null;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    // SSRF guard: only plain HTTP(S) is fetchable.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    // SSRF guard: only allowlisted hosts are fetched. This is the seam that
    // user/`catalog` cover URLs flow through, so a non-allowlisted (or private)
    // host is rejected before any request is issued.
    if (
      !isAllowedCoverHost(
        parsed.hostname,
        this.config.get<string>(COVER_PREVIEW_HOSTS_ENV),
      )
    ) {
      return null;
    }

    const hash = createHash('sha256').update(url).digest('hex').slice(0, 32);
    const urlExt = extensionFromPath(parsed.pathname);
    // A previously cached cover is only found by probing what `cacheFromUrl`
    // actually writes: the final name uses the response content type, which is
    // unknown before the download and may disagree with (or be absent from) the
    // URL. Probing the deterministic `<hash>.jpg|.png|.webp` set (URL extension
    // first, when present) makes the "already cached" check match the written
    // file, so an extensionless/re-typed URL is not re-downloaded every call.
    const cached = await this.findCached(hash, urlExt);
    if (cached !== null) {
      await this.ensureThumbnail(cached);
      return this.servedUrl(cached);
    }

    try {
      const response = await this.http.get(url);
      if (!response.ok) {
        return null;
      }
      const mime = (response.contentType ?? '')
        .split(';')[0]
        ?.trim()
        .toLowerCase();
      const extension =
        mime === undefined ? undefined : COVER_MIME_EXTENSION[mime];
      if (extension === undefined) {
        return null;
      }
      if (
        response.body.length === 0 ||
        response.body.length > MAX_COVER_BYTES
      ) {
        return null;
      }
      const finalName = `${hash}${extension}`;
      if (!(await this.exists(finalName))) {
        await mkdir(this.directory, { recursive: true });
        await writeFile(join(this.directory, finalName), response.body);
      }
      await this.ensureThumbnail(finalName);
      return this.servedUrl(finalName);
    } catch (error) {
      this.logger.warn(
        `Failed to cache cover "${url}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Reads one cached file for serving. Traversal-safe by construction: only a
   * 32-hex hash plus a known extension is accepted, and any failure (missing
   * file included) returns `null` rather than throwing.
   */
  async read(file: string): Promise<CachedCover | null> {
    if (!SAFE_COVER_FILE.test(file)) {
      return null;
    }
    const mimeType = COVER_EXTENSION_MIME[extname(file).toLowerCase()];
    if (mimeType === undefined) {
      return null;
    }
    try {
      const buffer = await readFile(join(this.directory, file));
      return { buffer, mimeType };
    } catch (error) {
      if (!isEnoent(error)) {
        this.logger.warn(
          `Failed to read cover "${file}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return null;
    }
  }

  /**
   * Reads the generated WebP thumbnail for a full cover filename
   * (`<hash>.<ext>` → `<hash>.thumb.webp`). Returns `null` when there is no
   * thumbnail; traversal-safe by construction.
   */
  async readThumbnail(file: string): Promise<CachedCover | null> {
    const thumb = thumbnailNameFor(file);
    if (thumb === null) {
      return null;
    }
    try {
      const buffer = await readFile(join(this.directory, thumb));
      return { buffer, mimeType: COVER_THUMBNAIL_MIME_TYPE };
    } catch (error) {
      if (!isEnoent(error)) {
        this.logger.warn(
          `Failed to read cover thumbnail "${thumb}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return null;
    }
  }

  /**
   * Best-effort: writes `<hash>.thumb.webp` for a stored full cover when it is
   * missing. A non-image/undecodable cover, an invalid filename, or any fs
   * error resolves to `false` rather than throwing.
   */
  async ensureThumbnail(file: string): Promise<boolean> {
    const thumb = thumbnailNameFor(file);
    if (thumb === null) {
      return false;
    }
    try {
      if (await this.exists(thumb)) {
        return true;
      }
      const cover = await this.read(file);
      if (cover === null) {
        return false;
      }
      const buffer = await makeThumbnail(cover.buffer);
      if (buffer === null) {
        return false;
      }
      await mkdir(this.directory, { recursive: true });
      await writeFile(join(this.directory, thumb), buffer);
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to generate cover thumbnail "${thumb}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * Deletes a stored cover and its thumbnail by served URL. A non-cover path or
   * an already-missing file is a no-op; any other unlink error is logged.
   */
  async removeByServedUrl(servedUrl: string | null): Promise<void> {
    if (servedUrl === null) {
      return;
    }
    const file = this.fileFromServedUrl(servedUrl);
    if (file === null) {
      return;
    }
    const thumb = thumbnailNameFor(file);
    for (const name of [file, thumb]) {
      if (name === null) {
        continue;
      }
      try {
        await unlink(join(this.directory, name));
      } catch (error) {
        if (!isEnoent(error)) {
          this.logger.warn(
            `Failed to remove cover file "${name}": ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }

  /**
   * The stored file for `hash`, if any: the URL extension hint first (so a URL
   * and its content type agreeing keeps the URL-derived name), then every
   * canonical content-type extension. Returns the basename or `null`.
   */
  private async findCached(
    hash: string,
    urlExt: string,
  ): Promise<string | null> {
    const extensions = [urlExt, ...Object.values(COVER_MIME_EXTENSION)].filter(
      (extension) => extension !== '',
    );
    for (const extension of new Set(extensions)) {
      const name = `${hash}${extension}`;
      if (await this.exists(name)) {
        return name;
      }
    }
    return null;
  }

  private async exists(name: string): Promise<boolean> {
    try {
      await stat(join(this.directory, name));
      return true;
    } catch {
      return false;
    }
  }
}

/** A path extension hint (`.jpeg` maps to `.jpg`); `''` when unrecognized. */
function extensionFromPath(pathname: string): string {
  const extension = extname(pathname).toLowerCase();
  if (!URL_EXTENSIONS.has(extension)) {
    return '';
  }
  return extension === '.jpeg' ? '.jpg' : extension;
}

/**
 * The thumbnail basename for a full cover filename (`<hash>.<ext>`), validated
 * against the strict thumbnail pattern, or `null` for an unsafe name.
 */
function thumbnailNameFor(file: string): string | null {
  if (!SAFE_COVER_FILE.test(file)) {
    return null;
  }
  const thumb = `${file.slice(0, 32)}.thumb${COVER_THUMBNAIL_EXTENSION}`;
  return SAFE_THUMB_FILE.test(thumb) ? thumb : null;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
