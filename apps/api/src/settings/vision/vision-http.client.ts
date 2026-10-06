import { Injectable } from '@nestjs/common';
import { VisionProviderError } from './vision.errors';

export interface VisionHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
}

export interface VisionHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
  /**
   * Raw response body. No provider reads it today (errors carry a safe status
   * message only); kept so a future provider can log/excerpt a body without
   * touching the transport.
   */
  text: () => Promise<string>;
}

/**
 * The single HTTP seam. Providers depend on this abstract class (used as the
 * Nest DI token); tests bind a fake so the suite never hits a real provider.
 */
export abstract class VisionHttpClient {
  abstract postJson(request: VisionHttpRequest): Promise<VisionHttpResponse>;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

/** Global `fetch` implementation with a hard per-request timeout. */
@Injectable()
export class FetchVisionHttpClient extends VisionHttpClient {
  async postJson(request: VisionHttpRequest): Promise<VisionHttpResponse> {
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...request.headers },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      // Never include the request headers/body — they carry the API key.
      throw new VisionProviderError(
        isAbortError(error) ? 'timeout' : 'network',
      );
    }
    return {
      status: response.status,
      ok: response.ok,
      json: async (): Promise<unknown> => {
        const body: unknown = await response.json();
        return body;
      },
      text: () => response.text(),
    };
  }
}
