import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CoverHttpClient } from './cover-http.client';
import { makeThumbnail } from './cover-thumbnail';
import {
  COVER_MIME_EXTENSION,
  COVER_PREVIEW_HOSTS_ENV,
  COVER_PREVIEW_PATH,
  COVER_PREVIEW_SECRET_ENV,
  COVER_PREVIEW_TTL_SECONDS,
  COVER_THUMBNAIL_MIME_TYPE,
  isAllowedCoverHost,
} from './covers.options';

/** One server-side fetched preview asset (already a thumbnail when possible). */
export interface PreviewAsset {
  buffer: Buffer;
  mimeType: string;
}

/** Session secret env var, used when no dedicated preview secret is set. */
const SESSION_SECRET_ENV = 'SESSION_SECRET';

/**
 * Server-side cover passthrough for **unsaved** candidates (re-enrichment
 * search results). The browser only ever receives an opaque, signed same-origin
 * `/api/covers/preview?u=<b64url>&s=<hmac>&e=<epoch>` URL; the external host is
 * fetched here and never persisted. The HMAC pins the URL and its expiry so the
 * route cannot be used as an open SSRF proxy, and the host allowlist bounds
 * where it may fetch.
 */
@Injectable()
export class CoverPreviewService {
  private readonly logger = new Logger(CoverPreviewService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: CoverHttpClient,
  ) {}

  /**
   * Opaque same-origin preview URL, or `null` when there is no cover. The
   * signature pins the URL **and** an expiry (epoch seconds); `now` is
   * injectable so tests can mint an already-expired link.
   */
  previewUrl(coverUrl: string | null, now: number = Date.now()): string | null {
    if (coverUrl === null || coverUrl.trim() === '') {
      return null;
    }
    const encoded = Buffer.from(coverUrl, 'utf8').toString('base64url');
    const expiry = Math.floor(now / 1000) + COVER_PREVIEW_TTL_SECONDS;
    const signature = this.sign(coverUrl, expiry);
    return `${COVER_PREVIEW_PATH}?u=${encoded}&s=${signature}&e=${String(expiry)}`;
  }

  /**
   * Verifies a signed preview reference and returns the external URL it may
   * fetch, or `null` for a forged/tampered URL, a missing or expired `e`, a
   * non-HTTP(S) scheme, or a host outside the allowlist.
   */
  resolve(
    u: string,
    s: string,
    e: string | undefined,
    now: number = Date.now(),
  ): string | null {
    let url: string;
    try {
      url = Buffer.from(u, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const expiry = parseExpiry(e);
    if (expiry === null) {
      return null;
    }
    if (!this.verify(url, expiry, s)) {
      return null;
    }
    if (expiry * 1000 <= now) {
      return null;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (
      !isAllowedCoverHost(
        parsed.hostname,
        this.config.get<string>(COVER_PREVIEW_HOSTS_ENV),
      )
    ) {
      return null;
    }
    return url;
  }

  /**
   * Fetches one preview external URL and renders an in-memory thumbnail. Falls
   * back to the original bytes when thumbnailing fails, and to `null` on any
   * download error or non-image response — it never throws.
   */
  async fetch(url: string): Promise<PreviewAsset | null> {
    try {
      const response = await this.http.get(url);
      if (!response.ok || response.body.length === 0) {
        return null;
      }
      const mime = (response.contentType ?? '')
        .split(';')[0]
        ?.trim()
        .toLowerCase();
      const thumb = await makeThumbnail(response.body);
      if (thumb !== null) {
        return { buffer: thumb, mimeType: COVER_THUMBNAIL_MIME_TYPE };
      }
      if (mime === undefined || COVER_MIME_EXTENSION[mime] === undefined) {
        return null;
      }
      return { buffer: response.body, mimeType: mime };
    } catch (error) {
      this.logger.warn(
        `Failed to fetch cover preview "${url}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private sign(url: string, expiry: number): string {
    return createHmac('sha256', this.secret())
      .update(previewMessage(url, expiry))
      .digest('base64url');
  }

  private verify(url: string, expiry: number, signature: string): boolean {
    let provided: Buffer;
    try {
      provided = Buffer.from(signature, 'base64url');
    } catch {
      return false;
    }
    const expected = createHmac('sha256', this.secret())
      .update(previewMessage(url, expiry))
      .digest();
    if (provided.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(provided, expected);
  }

  private secret(): string {
    const override = this.config.get<string>(COVER_PREVIEW_SECRET_ENV);
    if (override !== undefined && override.trim() !== '') {
      return override;
    }
    return this.config.get<string>(SESSION_SECRET_ENV) ?? '';
  }
}

function previewMessage(url: string, expiry: number): string {
  return `covers:preview:${url}:${String(expiry)}`;
}

/** Parses the `e` query value into a positive epoch-seconds integer, or null. */
function parseExpiry(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
