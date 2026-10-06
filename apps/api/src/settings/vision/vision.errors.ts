/**
 * Vision-provider error taxonomy.
 *
 * Every failure the pipeline can observe is reduced to one of these safe,
 * stable codes. Messages are fixed strings: no upstream response body and no
 * API key is ever carried in an error (the key must never reach a log).
 */
export type VisionErrorCode =
  | 'unknown_provider'
  | 'unauthorized'
  | 'model_not_found'
  | 'rate_limited'
  | 'timeout'
  | 'bad_response'
  | 'network'
  | 'server_error';

export type VisionTestCode = 'ok' | 'not_configured' | VisionErrorCode;

/**
 * All test-result codes, for Swagger's enum and exhaustive tests.
 *
 * `unknown_provider` is defensive-only: the active provider is always a
 * registered id (`resolveProviderId` rejects unknown stored ids), so the test
 * endpoint cannot currently produce it. It stays in the enum so error mapping
 * remains total if a future code path calls the registry with a raw id.
 */
export const VISION_TEST_CODES: readonly VisionTestCode[] = [
  'ok',
  'not_configured',
  'unknown_provider',
  'unauthorized',
  'model_not_found',
  'rate_limited',
  'timeout',
  'bad_response',
  'network',
  'server_error',
] as const;

const DEFAULT_MESSAGES: Record<VisionErrorCode, string> = {
  unknown_provider: 'The selected LLM provider is not available',
  unauthorized: 'The provider rejected the API key',
  model_not_found: 'The configured model was not found by the provider',
  rate_limited: 'The provider rate-limited the request; try again later',
  timeout: 'The provider did not respond in time',
  bad_response: 'The provider returned an unexpected response',
  network: 'The provider could not be reached',
  server_error: 'The provider returned a server error',
};

/** A provider call failed. Carries a safe code and a safe message only. */
export class VisionProviderError extends Error {
  constructor(
    readonly code: VisionErrorCode,
    message?: string,
  ) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'VisionProviderError';
  }
}

/** The active provider has no API key, so recognition cannot run. */
export class VisionUnavailableError extends Error {
  constructor() {
    super('No LLM provider API key is configured');
    this.name = 'VisionUnavailableError';
  }
}

/** Maps an upstream HTTP status to a safe code without reading the body. */
export function visionErrorFromStatus(status: number): VisionProviderError {
  if (status === 401 || status === 403) {
    return new VisionProviderError('unauthorized');
  }
  if (status === 404) {
    return new VisionProviderError('model_not_found');
  }
  if (status === 429) {
    return new VisionProviderError('rate_limited');
  }
  if (status >= 500) {
    return new VisionProviderError('server_error');
  }
  return new VisionProviderError(
    'bad_response',
    `The provider rejected the request (HTTP ${String(status)})`,
  );
}
