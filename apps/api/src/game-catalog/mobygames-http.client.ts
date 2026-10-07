import { Injectable } from '@nestjs/common';
import { MobygamesError } from './mobygames.errors';

export interface MobygamesHttpRequest {
  url: string;
  timeoutMs: number;
}

export interface MobygamesHttpResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}

/**
 * The single HTTP seam for MobyGames. `MobygamesClient` depends on this abstract
 * class (the Nest DI token); tests bind a fake so the suite never hits the API.
 */
export abstract class MobygamesHttpClient {
  abstract get(request: MobygamesHttpRequest): Promise<MobygamesHttpResponse>;
}

/** True for a `fetch` abort, including an `AbortSignal.timeout` expiry. */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

/** Global `fetch` implementation with a hard per-request timeout. */
@Injectable()
export class FetchMobygamesHttpClient extends MobygamesHttpClient {
  async get(request: MobygamesHttpRequest): Promise<MobygamesHttpResponse> {
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      throw new MobygamesError(
        true,
        isAbortError(error)
          ? 'MobyGames did not respond in time'
          : 'MobyGames could not be reached',
      );
    }
    return {
      status: response.status,
      ok: response.ok,
      json: async (): Promise<unknown> => response.json(),
    };
  }
}
