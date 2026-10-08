'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { isApiError } from '@/lib/api';
import { uploadImportPhotos } from '@/lib/api/upload';
import {
  ACCEPT_ATTR,
  buildDeclaredCounts,
  declaredCountError,
  formatBytes,
  MAX_PHOTO_BYTES,
  normalizeRasterMime,
  validateIntake,
  type PhotoKind,
} from '@/lib/import/selection';
import { convertHeicToJpeg } from '@/lib/import/heic';

const FIELD =
  'w-full rounded-md border border-edge bg-ink px-3 py-2 text-fog outline-none focus-visible:ring-2 focus-visible:ring-accent';
const PRIMARY_BUTTON =
  'rounded-md bg-accent px-4 py-2 font-medium text-ink hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60';

/** How many HEIC files are decoded at once, across every drop on the page. */
const HEIC_CONCURRENCY = 3;

/** Where the last uploaded batch id is kept so a returning user can find it. */
const LAST_BATCH_KEY = 'gameshelf.lastImportBatchId';

let heicInFlight = 0;
const heicWaiting: (() => void)[] = [];

/**
 * Runs one HEIC decode under a single shared budget. The counters are
 * module-level (not per `addFiles` call) so repeated drops cannot exceed
 * `HEIC_CONCURRENCY` in total, keeping the documented "at most 3 at a time"
 * guarantee true.
 */
function runHeicTask(task: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const start = (): void => {
      heicInFlight += 1;
      void task()
        .then(resolve, reject)
        .finally(() => {
          heicInFlight -= 1;
          const next = heicWaiting.shift();
          if (next !== undefined) next();
        });
    };
    if (heicInFlight < HEIC_CONCURRENCY) start();
    else heicWaiting.push(start);
  });
}

export type LlmReadiness =
  | { state: 'enabled'; providerLabel?: string }
  | { state: 'disabled' }
  | { state: 'unknown' };

type PhotoStatus = 'converting' | 'ready' | 'error';

interface PhotoItem {
  id: string;
  name: string;
  sizeBytes: number;
  kind: PhotoKind;
  uploadFile: File | null;
  previewUrl: string | null;
  status: PhotoStatus;
  error: string | null;
  declaredCount: string;
}

export function PhotoImportForm({
  readiness,
}: {
  readiness: LlmReadiness;
}): React.ReactElement {
  const router = useRouter();
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [rejections, setRejections] = useState<
    { name: string; reason: string }[]
  >([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<Set<string>>(new Set());
  const removedRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  // Revoke every object URL when the screen unmounts.
  useEffect(() => {
    mountedRef.current = true;
    const urls = urlsRef.current;
    return () => {
      mountedRef.current = false;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // Surface the previous batch (if any) so a returning user can reopen it.
  // Read in an effect: localStorage is unavailable during server rendering.
  useEffect(() => {
    try {
      setLastBatchId(window.localStorage.getItem(LAST_BATCH_KEY));
    } catch {
      // Storage can be unavailable (private mode); the link just stays hidden.
    }
  }, []);

  const enabled = readiness.state === 'enabled';
  const ready = photos.filter((photo) => photo.status === 'ready');
  const converting = photos.filter(
    (photo) => photo.status === 'converting',
  ).length;
  const hasInvalidCount = photos.some(
    (photo) => declaredCountError(photo.declaredCount) !== null,
  );
  const canSubmit =
    enabled &&
    ready.length > 0 &&
    converting === 0 &&
    !hasInvalidCount &&
    !submitting;
  const readyBytes = ready.reduce((sum, photo) => sum + photo.sizeBytes, 0);
  const percent =
    progress !== null && progress.total > 0
      ? Math.round((progress.loaded / progress.total) * 100)
      : 0;

  function addFiles(list: FileList | readonly File[]): void {
    const incoming = Array.from(list);
    if (incoming.length === 0) return;

    const { accepted, rejections: bad } = validateIntake(
      photos.length,
      incoming,
    );
    if (bad.length > 0) setRejections((current) => [...current, ...bad]);
    if (accepted.length === 0) return;

    const sources = new Map<string, File>();
    const items: PhotoItem[] = accepted.map(({ file, kind }) => {
      const id = crypto.randomUUID();
      if (kind === 'raster') {
        const uploadFile = normalizeRasterMime(file);
        const previewUrl = URL.createObjectURL(uploadFile);
        urlsRef.current.add(previewUrl);
        return {
          id,
          name: file.name,
          sizeBytes: file.size,
          kind,
          uploadFile,
          previewUrl,
          status: 'ready',
          error: null,
          declaredCount: '',
        };
      }
      sources.set(id, file);
      return {
        id,
        name: file.name,
        sizeBytes: file.size,
        kind,
        uploadFile: null,
        previewUrl: null,
        status: 'converting',
        error: null,
        declaredCount: '',
      };
    });

    setPhotos((current) => [...current, ...items]);

    const heicItems = items.filter((item) => item.kind === 'heic');
    if (heicItems.length === 0) return;
    for (const item of heicItems) {
      void runHeicTask(async () => {
        const source = sources.get(item.id);
        if (source === undefined) return;
        try {
          const jpeg = await convertHeicToJpeg(source);
          if (!mountedRef.current || removedRef.current.has(item.id)) return;
          if (jpeg.size > MAX_PHOTO_BYTES) {
            setPhotos((current) =>
              current.map((photo) =>
                photo.id === item.id
                  ? {
                      ...photo,
                      status: 'error',
                      error: `Too large (${formatBytes(jpeg.size)}). The limit is ${formatBytes(MAX_PHOTO_BYTES)}.`,
                    }
                  : photo,
              ),
            );
            return;
          }
          const previewUrl = URL.createObjectURL(jpeg);
          urlsRef.current.add(previewUrl);
          setPhotos((current) =>
            current.map((photo) =>
              photo.id === item.id
                ? { ...photo, uploadFile: jpeg, previewUrl, status: 'ready' }
                : photo,
            ),
          );
        } catch {
          if (!mountedRef.current || removedRef.current.has(item.id)) return;
          setPhotos((current) =>
            current.map((photo) =>
              photo.id === item.id
                ? {
                    ...photo,
                    status: 'error',
                    error: "We couldn't read this HEIC photo.",
                  }
                : photo,
            ),
          );
        }
      });
    }
  }

  function removePhoto(id: string): void {
    removedRef.current.add(id);
    const target = photos.find((photo) => photo.id === id);
    if (target?.previewUrl != null) {
      URL.revokeObjectURL(target.previewUrl);
      urlsRef.current.delete(target.previewUrl);
    }
    setPhotos((current) => current.filter((photo) => photo.id !== id));
  }

  function setCount(id: string, value: string): void {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === id ? { ...photo, declaredCount: value } : photo,
      ),
    );
  }

  function onInputChange(event: React.ChangeEvent<HTMLInputElement>): void {
    if (event.target.files !== null) addFiles(event.target.files);
    // Reset so re-selecting the same file fires `change` again.
    event.target.value = '';
  }

  function onDragOver(event: React.DragEvent): void {
    event.preventDefault();
    if (enabled && !submitting) setDragging(true);
  }

  function onDragLeave(event: React.DragEvent): void {
    event.preventDefault();
    setDragging(false);
  }

  function onDrop(event: React.DragEvent): void {
    event.preventDefault();
    setDragging(false);
    if (!enabled || submitting) return;
    addFiles(event.dataTransfer.files);
  }

  async function onSubmit(
    event: React.SubmitEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    const files = ready
      .map((photo) => photo.uploadFile)
      .filter((file): file is File => file !== null);
    const counts = buildDeclaredCounts(
      ready.map((photo) => photo.declaredCount),
    );

    setSubmitting(true);
    setFormError(null);
    setProgress(null);
    try {
      const res = await uploadImportPhotos(files, counts, {
        onProgress: setProgress,
      });
      try {
        window.localStorage.setItem(LAST_BATCH_KEY, res.batchId);
      } catch {
        // Non-blocking: navigation still works if storage is unavailable.
      }
      router.push(`/import/progress/${res.batchId}`);
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setFormError(
        isApiError(caught) && caught.status !== 0
          ? caught.status === 503
            ? 'Photo import is unavailable right now — no LLM API key is set.'
            : caught.userMessage
          : "We couldn't start the import. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const gateMessage =
    readiness.state === 'disabled'
      ? 'Photo import is off because no LLM API key is set. Add a key in Settings, then come back — or add games by hand.'
      : 'We couldn’t read the LLM settings, so photo import is paused. Try again — or add games by hand.';

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="space-y-8"
    >
      {lastBatchId !== null && (
        <p className="text-sm text-muted">
          <Link
            href={`/import/progress/${lastBatchId}`}
            className="text-accent underline underline-offset-4"
          >
            Check your most recent import
          </Link>
        </p>
      )}

      {readiness.state !== 'enabled' && (
        <div
          role="status"
          className="space-y-3 rounded-lg border border-edge bg-shelf/40 p-4"
        >
          <p className="text-sm text-fog">{gateMessage}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/games/new" className={PRIMARY_BUTTON}>
              Add a game by hand
            </Link>
            <Link href="/settings" className={SECONDARY_BUTTON}>
              Open settings
            </Link>
          </div>
        </div>
      )}

      {readiness.state === 'enabled' &&
        readiness.providerLabel !== undefined && (
          <p className="text-sm text-muted">
            Photos are sent to your configured LLM ({readiness.providerLabel}).
          </p>
        )}

      <label
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        aria-disabled={!enabled}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center transition-colors focus-within:ring-2 focus-within:ring-accent motion-reduce:transition-none ${
          dragging
            ? 'border-accent bg-accent/5'
            : 'border-edge bg-shelf/20 hover:border-accent/70'
        } ${enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          disabled={!enabled}
          onChange={onInputChange}
          className="sr-only"
        />
        <span className="text-base font-medium text-fog">
          Drop shelf photos here, or browse.
        </span>
        <span className="text-sm text-muted">
          JPEG, PNG, WebP or HEIC. Up to 20 MB each, up to 50 photos.
        </span>
      </label>

      {rejections.length > 0 && (
        <div
          role="alert"
          className="space-y-1 rounded-lg border border-danger/40 bg-danger/10 p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-danger">
              Some photos were not added.
            </p>
            <button
              type="button"
              onClick={() => {
                setRejections([]);
              }}
              className="rounded text-xs text-danger underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
            >
              Dismiss
            </button>
          </div>
          <ul className="space-y-0.5">
            {rejections.map((rejection, index) => (
              <li
                key={`${String(index)}-${rejection.name}`}
                className="text-xs text-danger"
              >
                {rejection.name} — {rejection.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {photos.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            If you know how many games are in a photo, add the number. We check
            it against what the model recognises and flag any difference. Leave
            it blank if you&rsquo;d rather not count.
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((photo) => {
              const countError = declaredCountError(photo.declaredCount);
              return (
                <li
                  key={photo.id}
                  className="flex flex-col gap-2 rounded-lg border border-edge bg-shelf/30 p-2"
                >
                  <div className="relative aspect-square overflow-hidden rounded-md bg-ink">
                    {photo.previewUrl !== null ? (
                      /* eslint-disable-next-line @next/next/no-img-element -- a just-picked local blob thumbnail; next/image cannot optimise an object URL */
                      <img
                        src={photo.previewUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : photo.status === 'converting' ? (
                      <span
                        aria-hidden
                        className="absolute inset-0 animate-pulse bg-edge/60 motion-reduce:animate-none"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-danger">
                        {photo.error ?? 'Unreadable'}
                      </span>
                    )}
                  </div>

                  <p className="truncate text-xs text-fog" title={photo.name}>
                    {photo.name}
                  </p>
                  <p className="text-xs text-muted">
                    {formatBytes(photo.sizeBytes)}
                    {photo.status === 'converting' && (
                      <span className="ml-1">Converting…</span>
                    )}
                  </p>

                  <div className="space-y-1">
                    <label
                      htmlFor={`count-${photo.id}`}
                      className="block text-xs text-muted"
                    >
                      Games (optional)
                    </label>
                    <input
                      id={`count-${photo.id}`}
                      type="text"
                      inputMode="numeric"
                      pattern="\d*"
                      maxLength={4}
                      placeholder="—"
                      value={photo.declaredCount}
                      disabled={photo.status !== 'ready'}
                      onChange={(event) => {
                        setCount(photo.id, event.target.value);
                      }}
                      className={FIELD}
                      aria-invalid={countError !== null}
                      aria-describedby={
                        countError !== null
                          ? `count-${photo.id}-error`
                          : undefined
                      }
                    />
                    {countError !== null && (
                      <p
                        id={`count-${photo.id}-error`}
                        className="text-xs text-danger"
                      >
                        {countError}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      removePhoto(photo.id);
                    }}
                    aria-label={`Remove ${photo.name}`}
                    className={`${SECONDARY_BUTTON} px-2 py-1 text-xs`}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-3 border-t border-edge pt-4">
        {formError !== null && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {formError}
          </p>
        )}

        {submitting && (
          <div>
            <div
              role="progressbar"
              aria-label="Upload progress"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 w-full overflow-hidden rounded-full bg-edge"
            >
              <div
                className="h-full bg-accent transition-[width] motion-reduce:transition-none"
                style={{ width: `${String(percent)}%` }}
              />
            </div>
            <p
              role="status"
              aria-live="polite"
              className="mt-1 text-xs text-muted"
            >
              Uploading… {percent}%
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" aria-live="polite" className="text-sm text-muted">
            {ready.length > 0 ? (
              <>
                {ready.length} {ready.length === 1 ? 'photo' : 'photos'} ready (
                {formatBytes(readyBytes)})
              </>
            ) : (
              'No photos selected yet.'
            )}
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className={PRIMARY_BUTTON}
          >
            {submitting
              ? 'Uploading…'
              : ready.length === 0
                ? 'Upload photos'
                : ready.length === 1
                  ? 'Upload 1 photo'
                  : `Upload ${String(ready.length)} photos`}
          </button>
        </div>
      </div>
    </form>
  );
}
