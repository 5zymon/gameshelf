'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isApiError,
  type GamePlatform,
  type ImportBatchProgress,
  type ImportJob,
  type ImportJobStatus,
} from '@/lib/api';
import { api } from '@/lib/api/browser';
import { ImportAttentionReview } from '@/components/import-attention-review';
import {
  batchCounts,
  pauseCopy,
  photoCountsLine,
  recognitionLine,
  sortPhotos,
  statusView,
  type ProgressTone,
} from '@/lib/import/progress';

const POLL_RUNNING_MS = 2000;
const POLL_PAUSED_MS = 15000;
/** The API caps a page at 100 — one page covers a full 50-photo batch. */
const PHOTO_LIMIT = 100;

const TONE_DOT: Readonly<Record<ProgressTone, string>> = {
  muted: 'bg-edge',
  active: 'bg-accent',
  success: 'bg-fog',
  warning: 'bg-accent-strong',
  danger: 'bg-danger',
};

const TONE_TEXT: Readonly<Record<ProgressTone, string>> = {
  muted: 'text-muted',
  active: 'text-accent',
  success: 'text-fog',
  warning: 'text-accent-strong',
  danger: 'text-danger',
};

const PRIMARY_BUTTON =
  'rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60';

function isTerminal(status: ImportJobStatus): boolean {
  return status !== 'queued' && status !== 'processing';
}

interface BatchSnapshot {
  progress: ImportBatchProgress;
  items: ImportJob[];
}

async function fetchBatchSnapshot(
  batchId: string,
  signal: AbortSignal,
): Promise<BatchSnapshot> {
  const [progress, jobs] = await Promise.all([
    api.importJobs.getBatch(batchId, { signal }),
    api.importJobs.list({ batchId, limit: PHOTO_LIMIT }, { signal }),
  ]);
  return { progress, items: jobs.items };
}

function CountCell({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-edge bg-shelf/30 p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-fog">{value}</dd>
    </div>
  );
}

export function ImportProgressView({
  batchId,
  initialProgress,
  initialItems,
  platforms,
}: {
  batchId: string;
  initialProgress: ImportBatchProgress;
  initialItems: readonly ImportJob[];
  platforms: GamePlatform[];
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('importProgress');
  // The paused banner's "Open settings" link reuses the import namespace.
  const tImport = useTranslations('import');
  const [progress, setProgress] =
    useState<ImportBatchProgress>(initialProgress);
  const [items, setItems] = useState<readonly ImportJob[]>(initialItems);
  const [reconnecting, setReconnecting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const photos = useMemo(() => sortPhotos(items), [items]);
  const photoIndex = useMemo(() => {
    const map = new Map<number, number>();
    photos.forEach((photo, index) => {
      map.set(photo.id, index + 1);
    });
    return map;
  }, [photos]);
  const counts = useMemo(
    () => batchCounts(photos, progress),
    [photos, progress],
  );

  const total = progress.total;
  const percent =
    total > 0 ? Math.round((progress.completedCount / total) * 100) : 0;
  const pause = pauseCopy(progress.pauseSource, t);

  // Snapshot requests are sequenced. Each request takes the next number and a
  // response is applied only while it is still the newest request, so a slow
  // poll started before a retry/dismiss cannot overwrite the fresh state
  // fetched by that action with stale data (which could reintroduce a
  // dismissed card or stop polling on a stale `allCompleted`).
  const snapshotSeqRef = useRef(0);

  const beginSnapshot = useCallback((): number => {
    snapshotSeqRef.current += 1;
    return snapshotSeqRef.current;
  }, []);

  const applySnapshot = useCallback(
    (seq: number, snapshot: BatchSnapshot): void => {
      if (seq !== snapshotSeqRef.current) return;
      setProgress(snapshot.progress);
      setItems(snapshot.items);
      setReconnecting(false);
    },
    [],
  );

  // Recursive polling. Runs at 2s while the import is live, throttles to a 15s
  // heartbeat while the queue is paused, and stops once the batch completes.
  useEffect(() => {
    if (progress.allCompleted) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const interval = progress.paused ? POLL_PAUSED_MS : POLL_RUNNING_MS;

    async function poll(): Promise<void> {
      const seq = beginSnapshot();
      try {
        const snapshot = await fetchBatchSnapshot(batchId, controller.signal);
        if (controller.signal.aborted) return;
        applySnapshot(seq, snapshot);
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (isApiError(caught) && caught.status === 401) {
          router.replace('/login');
          return;
        }
        // Keep the last good snapshot and try again on the next tick.
        setReconnecting(true);
      }
      // Reaching here means the tick was not aborted (both abort paths return
      // above), so schedule the next one.
      timer = setTimeout(() => void poll(), interval);
    }

    timer = setTimeout(() => void poll(), interval);
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [
    batchId,
    progress.allCompleted,
    progress.paused,
    router,
    beginSnapshot,
    applySnapshot,
  ]);

  // A paused batch still needs a fresh look when the tab regains focus, so a
  // user who fixes the configuration elsewhere sees the state without waiting.
  useEffect(() => {
    if (progress.allCompleted || !progress.paused) return;
    const controller = new AbortController();

    function refetch(): void {
      void (async () => {
        const seq = beginSnapshot();
        try {
          const snapshot = await fetchBatchSnapshot(batchId, controller.signal);
          if (controller.signal.aborted) return;
          applySnapshot(seq, snapshot);
        } catch (caught) {
          if (controller.signal.aborted) return;
          if (isApiError(caught) && caught.status === 401) {
            router.replace('/login');
          } else {
            setReconnecting(true);
          }
        }
      })();
    }

    function onVisibility(): void {
      if (document.visibilityState === 'visible') refetch();
    }

    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller.abort();
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [
    batchId,
    progress.allCompleted,
    progress.paused,
    router,
    beginSnapshot,
    applySnapshot,
  ]);

  async function onResume(): Promise<void> {
    if (resuming) return;
    setResuming(true);
    setResumeError(null);
    try {
      await api.importJobs.resume();
      const seq = beginSnapshot();
      const snapshot = await fetchBatchSnapshot(
        batchId,
        new AbortController().signal,
      );
      applySnapshot(seq, snapshot);
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        return;
      }
      setResumeError(t('error.resume'));
    } finally {
      setResuming(false);
    }
  }

  async function refreshSnapshot(): Promise<void> {
    const seq = beginSnapshot();
    try {
      const snapshot = await fetchBatchSnapshot(
        batchId,
        new AbortController().signal,
      );
      applySnapshot(seq, snapshot);
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        return;
      }
      setReconnecting(true);
    }
  }

  const finished = progress.allCompleted;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {finished ? t('titleDone') : t('title')}
        </h1>
        <p className="text-sm text-muted">
          {finished ? t('subtitleDone', { count: total }) : t('subtitle')}
        </p>
      </header>

      {progress.paused && (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-accent-strong/40 bg-accent-strong/10 p-4"
        >
          <div className="space-y-1">
            <p className="text-sm font-medium text-accent-strong">
              {t('paused')}
            </p>
            <p className="text-sm text-fog">
              {progress.pauseReason ?? pause.reasonFallback}
            </p>
            <p className="text-sm text-muted">{pause.hint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pause.settingsHref !== null && (
              <Link href={pause.settingsHref} className={SECONDARY_BUTTON}>
                {tImport('openSettings')}
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                void onResume();
              }}
              disabled={resuming}
              className={PRIMARY_BUTTON}
            >
              {resuming ? t('resuming') : t('resume')}
            </button>
          </div>
          {resumeError !== null && (
            <p role="alert" className="text-sm text-danger">
              {resumeError}
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div
          role="progressbar"
          aria-label={t('progressAria', {
            done: progress.completedCount,
            total,
          })}
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
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {t('processed', { done: progress.completedCount, total })}
        </p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CountCell label={t('counts.added')} value={counts.added} />
          <CountCell label={t('counts.needsReview')} value={counts.flagged} />
          <CountCell label={t('counts.failed')} value={counts.failed} />
          <CountCell
            label={t('counts.pending')}
            value={progress.pendingCount}
          />
        </dl>
      </div>

      <ImportAttentionReview
        photos={photos}
        platforms={platforms}
        photoIndex={photoIndex}
        onChanged={refreshSnapshot}
      />

      {photos.length === 0 ? (
        <p className="text-sm text-muted">{t('waiting')}</p>
      ) : (
        <div className="space-y-2">
          <h2 className="text-lg font-medium text-fog">{t('photos')}</h2>
          <ul className="space-y-2">
            {photos.map((photo) => {
              const view = statusView(photo.status, t);
              const recognition = recognitionLine(photo, t);
              const tone = photo.needsAttention
                ? 'border-accent-strong/40 bg-accent-strong/10'
                : photo.status === 'failed'
                  ? 'border-danger/40 bg-danger/10'
                  : 'border-edge bg-shelf/30';
              return (
                <li
                  key={photo.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 ${tone}`}
                >
                  <span
                    aria-hidden
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[view.tone]} ${view.busy ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-sm font-medium text-fog">
                        {t('photo', { n: photoIndex.get(photo.id) ?? 0 })}
                      </p>
                      <p className={`text-xs ${TONE_TEXT[view.tone]}`}>
                        {view.label}
                      </p>
                    </div>
                    <p className="text-sm text-muted">
                      {photoCountsLine(photo, t)}
                    </p>
                    {isTerminal(photo.status) && (
                      <p
                        className={
                          recognition.mismatch
                            ? 'text-sm text-danger'
                            : 'text-sm text-muted'
                        }
                      >
                        {recognition.text}
                      </p>
                    )}
                    {photo.status === 'failed' &&
                      photo.errorMessage !== null && (
                        <p className="text-sm text-danger">
                          {photo.errorMessage}
                        </p>
                      )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-edge pt-4">
        <Link href="/" className={SECONDARY_BUTTON}>
          {t('backToCatalog')}
        </Link>
        <Link href="/import" className={SECONDARY_BUTTON}>
          {t('importMore')}
        </Link>
        {reconnecting && (
          <p role="status" aria-live="polite" className="text-sm text-muted">
            {t('reconnecting')}
          </p>
        )}
      </div>
    </section>
  );
}
