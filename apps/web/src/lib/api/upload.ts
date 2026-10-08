import type { StartImportUploadResponse } from './contracts';
import { ApiError, apiErrorFromText } from './errors';

const UPLOAD_URL = '/api/import/upload';

export interface UploadProgress {
  loaded: number;
  total: number;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

/**
 * `POST /import/upload` over XMLHttpRequest so the browser reports upload
 * progress (fetch cannot). Multipart field names/shape mirror the API client:
 * repeated `files`, then one `declaredCounts` part per photo (empty = undeclared).
 */
export function uploadImportPhotos(
  files: readonly File[],
  declaredCounts: readonly string[],
  options: UploadOptions = {},
): Promise<StartImportUploadResponse> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(
        new ApiError({
          status: 0,
          url: UPLOAD_URL,
          body: null,
          code: 'ABORTED',
          message: 'Upload cancelled',
        }),
      );
      return;
    }

    const form = new FormData();
    for (const file of files) form.append('files', file);
    for (const count of declaredCounts) form.append('declaredCounts', count);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', UPLOAD_URL);
    xhr.responseType = 'text';

    const onAbort = (): void => {
      xhr.abort();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = (): void => {
      options.signal?.removeEventListener('abort', onAbort);
    };

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.({ loaded: event.loaded, total: event.total });
      }
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as StartImportUploadResponse);
        } catch (cause) {
          reject(
            new ApiError({
              status: xhr.status,
              url: UPLOAD_URL,
              body: xhr.responseText,
              code: 'INVALID_RESPONSE',
              cause,
              message: 'The server returned an invalid JSON response',
            }),
          );
        }
        return;
      }
      reject(apiErrorFromText(xhr.status, UPLOAD_URL, xhr.responseText));
    };
    xhr.onerror = () => {
      cleanup();
      reject(
        new ApiError({
          status: 0,
          url: UPLOAD_URL,
          body: null,
          code: 'NETWORK_ERROR',
          message: `Network request failed: POST ${UPLOAD_URL}`,
        }),
      );
    };
    xhr.onabort = () => {
      cleanup();
      reject(
        new ApiError({
          status: 0,
          url: UPLOAD_URL,
          body: null,
          code: 'ABORTED',
          message: 'Upload cancelled',
        }),
      );
    };

    xhr.send(form);
  });
}
