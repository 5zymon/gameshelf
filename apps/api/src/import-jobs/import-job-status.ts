/**
 * Import job status vocabulary.
 *
 * `import_jobs.status` is the only status record (ADR-005); the worker's claim
 * sets `processing` durably.
 */

/** Durable statuses at which no further processing will happen. */
export const TERMINAL_IMPORT_JOB_STATUSES: ReadonlySet<string> = new Set([
  'done',
  'needs_attention',
  'failed',
  'dismissed',
]);

export function isTerminalImportJobStatus(status: string): boolean {
  return TERMINAL_IMPORT_JOB_STATUSES.has(status);
}
