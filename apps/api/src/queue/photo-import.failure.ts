import { IgdbConfigError } from '../game-catalog/igdb.errors';
import { MobygamesConfigError } from '../game-catalog/mobygames.errors';
import {
  VisionProviderError,
  VisionUnavailableError,
} from '../settings/vision/vision.errors';
import type { ConfigErrorSource } from './photo-import.types';

const GENERIC_FAILURE_REASON = 'Photo recognition failed unexpectedly';

/**
 * A pipeline failure the worker should retry: a transient external/DB issue
 * (rate limit, timeout, network blip) rather than a permanent one. Thrown by
 * the pipeline so the worker leaves the row `processing` between attempts and
 * only `markFailed`s on the last attempt.
 */
export class RetryableImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableImportError';
  }
}

/**
 * A failure the worker must not retry (ADR-005; replaces BullMQ's
 * UnrecoverableError). The pipeline already marked the row failed. `cause`
 * carries the original error for the safe failure reason.
 */
export class PermanentImportError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PermanentImportError';
  }
}

/** A configuration error (rejected/absent credentials) that pauses the queue. */
export class ConfigurationImportError extends Error {
  constructor(
    readonly source: ConfigErrorSource,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigurationImportError';
  }
}

/**
 * The one classification seam used by the pipeline (both the vision and the
 * IGDB path) to tell a "configuration error → pause the queue" apart from an
 * ordinary permanent failure. Returns the integration to fix, or null.
 */
export function configErrorSource(error: unknown): ConfigErrorSource | null {
  if (error instanceof ConfigurationImportError) {
    return error.source;
  }
  if (error instanceof IgdbConfigError) {
    return 'igdb';
  }
  if (error instanceof MobygamesConfigError) {
    return 'mobygames';
  }
  if (error instanceof VisionUnavailableError) {
    return 'llm';
  }
  if (error instanceof VisionProviderError && error.code === 'unauthorized') {
    return 'llm';
  }
  return null;
}

/** Vision error codes worth retrying; everything else is permanent. */
const RETRYABLE_VISION_CODES: ReadonlySet<string> = new Set([
  'rate_limited',
  'timeout',
  'network',
  'server_error',
]);

/**
 * True when a retry may help. A `RetryableImportError` is always
 * retryable; a `VisionProviderError` only for transient codes.
 */
export function isRetryableImportError(error: unknown): boolean {
  if (configErrorSource(error) !== null) {
    return false;
  }
  if (error instanceof RetryableImportError) {
    return true;
  }
  return (
    error instanceof VisionProviderError &&
    RETRYABLE_VISION_CODES.has(error.code)
  );
}

/**
 * Boundary between the vision layer and the persisted job failure reason.
 * Ticket 3.5 catches any error from `VisionService.recognize`, calls this, and
 * passes the result to `ImportJobsService.markFailed(jobId, reason)`.
 * Always returns a non-empty, safe string; never carries an API key or the
 * raw model output.
 */
export function photoImportFailureReason(error: unknown): string {
  if (error instanceof VisionUnavailableError) {
    return 'Photo import is unavailable: no LLM provider API key is configured';
  }
  if (error instanceof VisionProviderError) {
    return error.message;
  }
  if (error instanceof RetryableImportError) {
    return error.message;
  }
  if (error instanceof ConfigurationImportError) {
    return error.message;
  }
  if (error instanceof IgdbConfigError) {
    return error.message;
  }
  if (error instanceof MobygamesConfigError) {
    return error.message;
  }
  return GENERIC_FAILURE_REASON;
}
