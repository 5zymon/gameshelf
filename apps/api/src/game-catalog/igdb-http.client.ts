import { Injectable } from '@nestjs/common';
import { IgdbError } from './igdb.errors';

export interface IgdbHttpRequest {
  url: string;
  headers: Record<string, string>;
  /** IGDB uses an APICalypse query string, not JSON. */
  body: string;
  timeoutMs: number;
}

export interface IgdbHttpResponse {
  status: number;
  ok: boolean;
  /** Optional header seam; used to honor Retry-After on a 429. */
  headers?: { get(name: string): string | null };
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

/**
 * The single HTTP seam for IGDB. `IgdbClient` depends on this abstract class
 * (the Nest DI token); tests bind a fake so the suite never hits IGDB.
 */
export abstract class IgdbHttpClient {
  abstract post(request: IgdbHttpRequest): Promise<IgdbHttpResponse>;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

/** Global `fetch` implementation with a hard per-request timeout. */
@Injectable()
export class FetchIgdbHttpClient extends IgdbHttpClient {
  async post(request: IgdbHttpRequest): Promise<IgdbHttpResponse> {
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      throw new IgdbError(
        true,
        isAbortError(error)
          ? 'IGDB did not respond in time'
          : 'IGDB could not be reached',
      );
    }
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      json: async (): Promise<unknown> => response.json(),
      text: () => response.text(),
    };
  }
}
