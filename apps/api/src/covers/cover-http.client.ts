import { Injectable } from '@nestjs/common';
import type {
  ReadableStream as WebReadableStream,
  ReadableStreamDefaultReader,
} from 'node:stream/web';
import { COVER_REQUEST_TIMEOUT_MS, MAX_COVER_BYTES } from './covers.options';

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

/**
 * Global `fetch` implementation: follows redirects, bounds the request with a
 * hard timeout, and caps the body at `MAX_COVER_BYTES` while it is being read —
 * a body whose declared `Content-Length` already exceeds the cap is never read
 * at all, and a chunked/extensionless response is cancelled as soon as the
 * accumulated bytes cross the cap. An over-cap body is reported as an empty
 * body, which the cache treats as a miss (so it can never hold a 5 MB+ buffer).
 */
@Injectable()
export class FetchCoverHttpClient extends CoverHttpClient {
  async get(url: string): Promise<CoverHttpResponse> {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(COVER_REQUEST_TIMEOUT_MS),
    });
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
