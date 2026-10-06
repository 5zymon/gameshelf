/**
 * Import job status vocabulary and the live/durable merge (ticket 3.6).
 *
 * `import_jobs.status` is the durable record (MySQL); BullMQ state (Redis) is
 * a supplementary signal that lets a poller see `processing` while a worker is
 * active. Redis is never treated as an audit log (ADR-002): a terminal durable
 * status always wins, and an unknown/unavailable queue state changes nothing.
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

/** BullMQ states that mean "waiting to run", not "running". */
const QUEUED_QUEUE_STATES: ReadonlySet<string> = new Set([
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
]);

/**
 * Merges the durable status with the raw BullMQ state for a non-terminal job.
 * A terminal durable status (or no queue state) is returned unchanged, so a
 * Redis glitch can never fabricate a terminal outcome.
 */
export function mergeImportJobStatus(
  durableStatus: string,
  queueState: string | null,
): string {
  if (isTerminalImportJobStatus(durableStatus) || queueState === null) {
    return durableStatus;
  }
  if (queueState === 'active') {
    return 'processing';
  }
  if (QUEUED_QUEUE_STATES.has(queueState)) {
    return 'queued';
  }
  return durableStatus;
}
