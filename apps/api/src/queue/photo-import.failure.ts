import {
  VisionProviderError,
  VisionUnavailableError,
} from '../settings/vision/vision.errors';

const GENERIC_FAILURE_REASON = 'Photo recognition failed unexpectedly';

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
  return GENERIC_FAILURE_REASON;
}
