import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ReadableStream as WebReadableStream,
  ReadableStreamDefaultReader,
} from 'node:stream/web';
import {
  COVER_PREVIEW_HOSTS_ENV,
  COVER_REQUEST_TIMEOUT_MS,
  MAX_COVER_BYTES,
  MAX_COVER_REDIRECTS,
  isAllowedCoverHost,
} from './covers.options';

/** One downloaded cover response. */
export interface CoverHttpResponse {
  ok: boolean;
  status: number;
  contentType: string | null;
  body: Buffer;
}

/**
 * The single HTTP seam for cover downloads. `CoverCacheService` depends on this
 * abstract class (the Nest DI token); tests bind a fake so the suite never hits
 * an external host.
 */
export abstract class CoverHttpClient {
  abstract get(url: string): Promise<CoverHttpResponse>;
}

/** HTTP statuses that carry a `Location` and are followed as redirects. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

/**
 * Global `fetch` implementation: follows redirects manually, bounds the request
 * with a hard timeout, and caps the body at `MAX_COVER_BYTES` while it is being
 * read — a body whose declared `Content-Length` already exceeds the cap is never
 * read at all, and a chunked/extensionless response is cancelled as soon as the
 * accumulated bytes cross the cap. An over-cap body is reported as an empty
 * body, which the cache treats as a miss (so it can never hold a 5 MB+ buffer).
 *
 * SSRF guard: every hop — the initial request and each redirect target — is
 * checked against the cover host allowlist *before* the request is issued, so an
 * off-allowlist redirect target is never connected to. Redirects are bounded by
 * `MAX_COVER_REDIRECTS`; a missing/malformed/off-allowlist `Location` or an
 * exceeded hop cap aborts the download.
 */
@Injectable()
export class FetchCoverHttpClient extends CoverHttpClient {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async get(url: string): Promise<CoverHttpResponse> {
    this.assertAllowed(this.urlHostname(url));

    let currentUrl = url;
    for (let hop = 0; ; hop += 1) {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(COVER_REQUEST_TIMEOUT_MS),
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        // A redirect body is never used; release it before deciding the next
        // hop so a 3xx response cannot hold memory or an open stream.
        await cancelBody(response.body);
        if (hop >= MAX_COVER_REDIRECTS) {
          throw new Error(
            `Cover redirect exceeded ${String(MAX_COVER_REDIRECTS)} hops: ${url}`,
          );
        }
        currentUrl = this.redirectTarget(response, currentUrl);
        continue;
      }

      const contentType = response.headers.get('content-type');
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_COVER_BYTES) {
        await cancelBody(response.body);
        return {
          ok: response.ok,
          status: response.status,
          contentType,
          body: Buffer.alloc(0),
        };
      }
      const body = await readBodyWithinCap(response.body, MAX_COVER_BYTES);
      return { ok: response.ok, status: response.status, contentType, body };
    }
  }

  /**
   * Resolves the next hop from a redirect response, rejecting a missing,
   * malformed, non-HTTP(S) or off-allowlist `Location` before any request is
   * made to it.
   */
  private redirectTarget(response: Response, base: string): string {
    const location = response.headers.get('location');
    if (location === null || location.trim() === '') {
      throw new Error(`Cover redirect is missing a Location header: ${base}`);
    }
    let target: URL;
    try {
      // A relative `Location` resolves against the URL that produced it.
      target = new URL(location, base);
    } catch {
      throw new Error(`Cover redirect target is malformed: ${location}`);
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error(`Cover redirect left the allowlist: ${target.href}`);
    }
    this.assertAllowed(target.hostname);
    return target.href;
  }

  private assertAllowed(hostname: string | null): void {
    if (hostname === null || !this.isAllowed(hostname)) {
      throw new Error(`Cover host is not allowlisted: ${hostname ?? ''}`);
    }
  }

  private isAllowed(hostname: string): boolean {
    return isAllowedCoverHost(
      hostname,
      this.config.get<string>(COVER_PREVIEW_HOSTS_ENV),
    );
  }

  /** The hostname of an absolute HTTP(S) URL, or `null` when it is not one. */
  private urlHostname(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.hostname;
  }
}

/**
 * Reads a web `ReadableStream` into a single `Buffer`, aborting the stream the
 * moment the accumulated size exceeds `cap` (returns an empty buffer instead,
 * so memory stays bounded even when the upstream declares no `Content-Length`).
 */
async function readBodyWithinCap(
  body: WebReadableStream<Uint8Array> | null,
  cap: number,
): Promise<Buffer> {
  if (body === null) {
    return Buffer.alloc(0);
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > cap) {
        await cancelReader(reader);
        return Buffer.alloc(0);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await cancelReader(reader);
    throw error;
  }
  return Buffer.concat(chunks, total);
}

/** Cancels a response body that is never read; failures are non-fatal. */
async function cancelBody(
  body: WebReadableStream<Uint8Array> | null,
): Promise<void> {
  if (body === null) {
    return;
  }
  await cancelReader(body.getReader());
}

/** Releases a reader, ignoring any error from an already-errored stream. */
async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The stream may already be errored/closed; the response is discarded
    // either way, so a failed cancel must not surface as a download error.
  }
}
