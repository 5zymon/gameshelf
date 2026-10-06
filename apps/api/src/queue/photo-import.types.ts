/**
 * ADR-002 job payload: a reference to the ephemeral photo plus the optional
 * declared count (spec §4.2.1). Ticket 3.2 populates this.
 */
export interface PhotoImportJobData {
  photoRef: string;
  declaredCount?: number | null;
}

/**
 * ADR-002 job result contract. Ticket 3.5 maps this onto
 * `ImportJobsService.markCompleted(jobId, result)`.
 */
export interface PhotoImportJobResult {
  /** `VisionRecognitionResult.items.length` — never the model's advisory count. */
  recognizedCount: number;
  importedCount: number;
  unrecognizedCount: number;
}
