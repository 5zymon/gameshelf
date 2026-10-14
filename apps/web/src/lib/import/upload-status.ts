import type { UploadProgress } from '@/lib/api/upload';

export type UploadStatus =
  { phase: 'uploading'; percent: number | null } | { phase: 'starting' };

/**
 * What the /import submit is doing. `percent` is null until the browser
 * reports a computable size; once every byte is sent, or the server accepted
 * the batch and the page is navigating, the wait is server-side and
 * unmeasured, so it reads as `starting`. Floored so 100% is never shown while
 * bytes are still in flight.
 */
export function uploadStatus(
  progress: UploadProgress | null,
  accepted: boolean,
): UploadStatus {
  if (accepted) return { phase: 'starting' };
  if (progress === null || progress.total <= 0) {
    return { phase: 'uploading', percent: null };
  }
  if (progress.loaded >= progress.total) return { phase: 'starting' };
  return {
    phase: 'uploading',
    percent: Math.floor((progress.loaded / progress.total) * 100),
  };
}
