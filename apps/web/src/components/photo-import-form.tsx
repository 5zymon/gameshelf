'use client';

import { useLocale, useTranslations } from 'next-intl';
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
  'w-full h-10 rounded-control border border-edge bg-field px-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent/55 focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60';
const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60';
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';
const SMALL_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-3 py-1.5 text-xs leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';

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
  const t = useTranslations('import');
  const locale = useLocale();
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
    (photo) => declaredCountError(photo.declaredCount, t) !== null,
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
      t,
      locale,
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
                      error: t('tooLarge', {
                        size: formatBytes(jpeg.size, locale),
                        limit: formatBytes(MAX_PHOTO_BYTES, locale),
                      }),
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
                    error: t('heicError'),
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
      t,
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
            ? t('error.unavailable')
            : caught.userMessage
          : t('error.generic'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const gateMessage =
    readiness.state === 'disabled' ? t('gate.disabled') : t('gate.unknown');

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
            className="text-accent-text underline underline-offset-4"
          >
            {t('recentImport')}
          </Link>
        </p>
      )}

      {readiness.state !== 'enabled' && (
        <div
          role="status"
          className="space-y-3 rounded-card border border-edge bg-surface p-4 shadow-[var(--shadow-card)]"
        >
          <p className="text-sm text-ink">{gateMessage}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/games/new" className={PRIMARY_BUTTON}>
              {t('addByHand')}
            </Link>
            <Link href="/settings" className={SECONDARY_BUTTON}>
              {t('openSettings')}
            </Link>
          </div>
        </div>
      )}

      {readiness.state === 'enabled' &&
        readiness.providerLabel !== undefined && (
          <p className="text-sm text-muted">
            {t('providerNotice', { provider: readiness.providerLabel })}
          </p>
        )}

      <label
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        aria-disabled={!enabled}
        className={`flex flex-col items-center justify-center gap-2 rounded-card border border-dashed px-6 py-12 text-center transition-colors duration-[140ms] ease-[ease] motion-reduce:transition-none focus-within:border-accent/55 focus-within:ring-[3px] focus-within:ring-accent/15 ${
          dragging
            ? 'border-accent bg-accent-soft'
            : 'border-edge bg-surface hover:border-edge-strong'
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
        <span className="text-base font-medium text-ink">{t('dropzone')}</span>
        <span className="text-sm text-muted">{t('dropzoneHint')}</span>
      </label>

      {rejections.length > 0 && (
        <div
          role="alert"
          className="space-y-1 rounded-control border border-danger/40 bg-danger/10 p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-danger">
              {t('rejections.title')}
            </p>
            <button
              type="button"
              onClick={() => {
                setRejections([]);
              }}
              className="rounded-control text-xs text-danger underline underline-offset-4"
            >
              {t('dismiss')}
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
          <p className="text-sm text-muted">{t('countsHint')}</p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((photo) => {
              const countError = declaredCountError(photo.declaredCount, t);
              return (
                <li
                  key={photo.id}
                  className="flex flex-col gap-2 rounded-control border border-edge bg-surface-2 p-2"
                >
                  <div className="relative aspect-square overflow-hidden rounded-control bg-canvas">
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
                        {photo.error ?? t('unreadable')}
                      </span>
                    )}
                  </div>

                  <p className="truncate text-xs text-ink" title={photo.name}>
                    {photo.name}
                  </p>
                  <p className="text-xs text-muted">
                    {formatBytes(photo.sizeBytes, locale)}
                    {photo.status === 'converting' && (
                      <span className="ml-1">{t('converting')}</span>
                    )}
                  </p>

                  <div className="space-y-1">
                    <label
                      htmlFor={`count-${photo.id}`}
                      className="block text-xs text-muted"
                    >
                      {t('countLabel')}
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
                    aria-label={`${t('remove')} ${photo.name}`}
                    className={SMALL_BUTTON}
                  >
                    {t('remove')}
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
            className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {formError}
          </p>
        )}

        {submitting && (
          <div>
            <div
              role="progressbar"
              aria-label={t('uploadProgress')}
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
              {t('uploading')} {percent}%
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" aria-live="polite" className="text-sm text-muted">
            {ready.length > 0
              ? t('ready', {
                  count: ready.length,
                  size: formatBytes(readyBytes, locale),
                })
              : t('noPhotos')}
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className={PRIMARY_BUTTON}
          >
            {submitting
              ? t('uploading')
              : ready.length === 0
                ? t('uploadButton.none')
                : ready.length === 1
                  ? t('uploadButton.one')
                  : t('uploadButton.other', { count: ready.length })}
          </button>
        </div>
      </div>
    </form>
  );
}
