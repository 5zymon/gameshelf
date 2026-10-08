'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  isApiError,
  type ImportBatchProgress,
  type ImportJob,
  type ImportJobStatus,
} from '@/lib/api';
import { api } from '@/lib/api/browser';
import {
  batchCounts,
  jobCounts,
  pauseCopy,
  plural,
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
  'rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60';

function isTerminal(status: ImportJobStatus): boolean {
  return status !== 'queued' && status !== 'processing';
}

/** The per-photo counts sentence (games committed / flagged for review). */
function photoCountsLine(photo: ImportJob): string {
  if (photo.status === 'queued') return 'Waiting in the queue.';
  if (photo.status === 'processing') return 'Reading the photo…';
  const counts = jobCounts(photo);
  const parts = [
    `Added ${String(counts.added)} ${plural(counts.added, 'game')}.`,
  ];
  if (counts.flagged > 0) {
    parts.push(
      `${String(counts.flagged)} ${plural(counts.flagged, 'game')} need review.`,
    );
  }
  return parts.join(' ');
}

/** Declared vs recognized sentence, plus whether to flag the mismatch. */
function recognitionLine(photo: ImportJob): {
  text: string;
  mismatch: boolean;
} {
  const recognized = jobCounts(photo).recognized;
  if (photo.declaredCount === null) {
    return {
      text: `Recognized ${String(recognized)} ${plural(recognized, 'game')}.`,
      mismatch: false,
    };
  }
  return {
    text: `You declared ${String(photo.declaredCount)}; recognized ${String(recognized)}.`,
    mismatch: photo.declaredCountMismatch,
  };
}

async function fetchBatchSnapshot(
  batchId: string,
  signal: AbortSignal,
): Promise<{ progress: ImportBatchProgress; items: ImportJob[] }> {
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
}: {
  batchId: string;
  initialProgress: ImportBatchProgress;
  initialItems: readonly ImportJob[];
}): React.ReactElement {
  const router = useRouter();
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
  const failed = useMemo(
    () => photos.filter((photo) => photo.status === 'failed'),
    [photos],
  );

  const total = progress.total;
  const percent =
    total > 0 ? Math.round((progress.completedCount / total) * 100) : 0;
  const pause = pauseCopy(progress.pauseSource);

  // Recursive polling. Runs at 2s while the import is live, throttles to a 15s
  // heartbeat while the queue is paused, and stops once the batch completes.
  useEffect(() => {
    if (progress.allCompleted) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const interval = progress.paused ? POLL_PAUSED_MS : POLL_RUNNING_MS;

    async function poll(): Promise<void> {
      try {
        const snapshot = await fetchBatchSnapshot(batchId, controller.signal);
        if (controller.signal.aborted) return;
        setProgress(snapshot.progress);
        setItems(snapshot.items);
        setReconnecting(false);
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
  }, [batchId, progress.allCompleted, progress.paused, router]);

  // A paused batch still needs a fresh look when the tab regains focus, so a
  // user who fixes the configuration elsewhere sees the state without waiting.
  useEffect(() => {
    if (progress.allCompleted || !progress.paused) return;
    const controller = new AbortController();

    function refetch(): void {
      void (async () => {
        try {
          const snapshot = await fetchBatchSnapshot(batchId, controller.signal);
          if (controller.signal.aborted) return;
          setProgress(snapshot.progress);
          setItems(snapshot.items);
          setReconnecting(false);
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
  }, [batchId, progress.allCompleted, progress.paused, router]);

  async function onResume(): Promise<void> {
    if (resuming) return;
    setResuming(true);
    setResumeError(null);
    try {
      await api.importJobs.resume();
      const snapshot = await fetchBatchSnapshot(
        batchId,
        new AbortController().signal,
      );
      setProgress(snapshot.progress);
      setItems(snapshot.items);
      setReconnecting(false);
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        return;
      }
      setResumeError(
        "We couldn't resume the queue. Check your connection and try again.",
      );
    } finally {
      setResuming(false);
    }
  }

  const finished = progress.allCompleted;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {finished ? 'Import finished' : 'Importing photos'}
        </h1>
        <p className="text-sm text-muted">
          {finished
            ? `All ${String(total)} ${plural(total, 'photo')} processed.`
            : 'You can leave this page — the import keeps running.'}
        </p>
      </header>

      {progress.paused && (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-accent-strong/40 bg-accent-strong/10 p-4"
        >
          <div className="space-y-1">
            <p className="text-sm font-medium text-accent-strong">
              Queue paused
            </p>
            <p className="text-sm text-fog">
              {progress.pauseReason ?? pause.reasonFallback}
            </p>
            <p className="text-sm text-muted">{pause.hint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pause.settingsHref !== null && (
              <Link href={pause.settingsHref} className={SECONDARY_BUTTON}>
                Open settings
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
              {resuming ? 'Resuming…' : 'Resume queue'}
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
          aria-label={`${String(progress.completedCount)} of ${String(total)} photos processed`}
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
          {String(progress.completedCount)} of {String(total)}{' '}
          {plural(total, 'photo')} processed
        </p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CountCell label="Added" value={counts.added} />
          <CountCell label="Needs review" value={counts.flagged} />
          <CountCell label="Failed" value={counts.failed} />
          <CountCell label="Still to process" value={progress.pendingCount} />
        </dl>
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-muted">Waiting for the first photo…</p>
      ) : (
        <div className="space-y-2">
          <h2 className="text-lg font-medium text-fog">Photos</h2>
          <ul className="space-y-2">
            {photos.map((photo) => {
              const view = statusView(photo.status);
              const recognition = recognitionLine(photo);
              return (
                <li
                  key={photo.id}
                  className="flex items-start gap-3 rounded-lg border border-edge bg-shelf/30 p-3"
                >
                  <span
                    aria-hidden
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[view.tone]} ${view.busy ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-sm font-medium text-fog">
                        Photo {photoIndex.get(photo.id) ?? 0}
                      </p>
                      <p className={`text-xs ${TONE_TEXT[view.tone]}`}>
                        {view.label}
                      </p>
                    </div>
                    <p className="text-sm text-muted">
                      {photoCountsLine(photo)}
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

      {failed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium text-fog">Photos that failed</h2>
          <ul className="space-y-2">
            {failed.map((photo) => (
              <li
                key={photo.id}
                className="rounded-lg border border-danger/40 bg-danger/10 p-3"
              >
                <p className="text-sm font-medium text-fog">
                  Photo {photoIndex.get(photo.id) ?? 0}
                </p>
                <p className="text-sm text-danger">
                  {photo.errorMessage ?? 'The photo could not be processed.'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-edge pt-4">
        <Link href="/" className={SECONDARY_BUTTON}>
          Back to catalog
        </Link>
        <Link href="/import" className={SECONDARY_BUTTON}>
          Import more photos
        </Link>
        {reconnecting && (
          <p role="status" aria-live="polite" className="text-sm text-muted">
            Reconnecting…
          </p>
        )}
      </div>
    </section>
  );
}
