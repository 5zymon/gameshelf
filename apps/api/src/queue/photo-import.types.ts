/** One claimed attempt of an `import_jobs` row (ADR-005): the worker → handler → pipeline unit of work. */
export interface PhotoImportRun {
  importJobId: string;
  photoRef: string | null;
  /** 1-based attempt number (`import_jobs.attempts` after the claim). */
  attempt: number;
  maxAttempts: number;
}

/**
 * ADR-005 job result contract. Ticket 3.5 maps this onto
 * `ImportJobsService.markCompleted(jobId, result)`.
 */
export interface PhotoImportJobResult {
  /** `VisionRecognitionResult.items.length` — never the model's advisory count. */
  recognizedCount: number;
  importedCount: number;
  unrecognizedCount: number;
}

/** Which external integration's configuration error paused the queue (3.10). */
export type ConfigErrorSource = 'llm' | 'igdb' | 'mobygames';
