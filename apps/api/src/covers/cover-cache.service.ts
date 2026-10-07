import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { CoverHttpClient } from './cover-http.client';
import {
  COVERS_DIR_ENV,
  COVER_EXTENSION_MIME,
  COVER_MIME_EXTENSION,
  COVER_URL_PREFIX,
  DEFAULT_COVERS_DIR,
  MAX_COVER_BYTES,
} from './covers.options';

/** A stored cover file plus the content type inferred from its extension. */
export interface CachedCover {
  buffer: Buffer;
  mimeType: string;
}

/** The only filenames `read` serves: a 32-hex hash and a known extension. */
const SAFE_COVER_FILE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

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
    const raw = this.config.get<string>(COVERS_DIR_ENV);
    return raw !== undefined && raw.trim() !== ''
      ? raw.trim()
      : DEFAULT_COVERS_DIR;
  }

  /** Same-origin URL a cached file is served at. */
  servedUrl(name: string): string {
    return `${COVER_URL_PREFIX}/${name}`;
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

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
