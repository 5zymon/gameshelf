import type { TranslatorFor } from '@/i18n/translate';
import type {
  GamePlatform,
  ImportBatchProgress,
  ImportJob,
  ImportJobStatus,
  ImportPauseSource,
} from '@/lib/api';

/** Visual tone of a status; maps to the shared `@theme` color tokens. */
export type ProgressTone =
  'muted' | 'active' | 'success' | 'warning' | 'danger';

export interface PhotoStatusView {
  label: string;
  tone: ProgressTone;
  /** Whether the status is actively working (drives the pulsing dot). */
  busy: boolean;
}

/**
 * One status vocabulary for the whole view. `needs_attention` is a terminal
 * success-with-caveat, not a failure; `dismissed` is a terminal no-op.
 * Labels come from the `importProgress` namespace (`status.*`).
 */
const PHOTO_STATUS: Readonly<
  Record<ImportJobStatus, { tone: ProgressTone; busy: boolean }>
> = {
  queued: { tone: 'muted', busy: false },
  processing: { tone: 'active', busy: true },
  done: { tone: 'success', busy: false },
  needs_attention: { tone: 'warning', busy: false },
  failed: { tone: 'danger', busy: false },
  dismissed: { tone: 'muted', busy: false },
};

export function statusView(
  status: ImportJobStatus,
  t: TranslatorFor<'importProgress'>,
): PhotoStatusView {
  const { tone, busy } = PHOTO_STATUS[status];
  return { label: t(`status.${status}`), tone, busy };
}

export interface JobCounts {
  /** Games committed to the catalog (`importedCount`). */
  added: number;
  /** Recognized but unresolved titles (`unrecognizedCount`). */
  flagged: number;
  /** Titles still waiting on resolution. */
  pending: number;
  /** Titles the model recognized. */
  recognized: number;
  /** Failure is photo-level (`status === 'failed'`), never a count. */
  failed: boolean;
}

/**
 * Per-photo counts. There is deliberately no distinct "skipped" counter: a
 * photo either commits games (`added`), flags titles for review (`flagged`), or
 * fails as a whole.
 */
export function jobCounts(job: ImportJob): JobCounts {
  return {
    added: job.importedCount,
    flagged: job.unrecognizedCount,
    pending: job.pendingCount,
    recognized: job.recognizedCount,
    failed: job.status === 'failed',
  };
}

export interface BatchCounts {
  added: number;
  flagged: number;
  failed: number;
}

/**
 * Batch totals. Added/flagged games are summed per photo; photo failures come
 * from the aggregate endpoint (a failed photo contributes zero games).
 */
export function batchCounts(
  items: readonly ImportJob[],
  progress: ImportBatchProgress,
): BatchCounts {
  let added = 0;
  let flagged = 0;
  for (const item of items) {
    added += item.importedCount;
    flagged += item.unrecognizedCount;
  }
  return { added, flagged, failed: progress.failed };
}

/**
 * Photos ordered by ascending id. The API stores no original filename and
 * `photoRef` is opaque, so the stable id order is what "Photo 1, Photo 2 …"
 * means.
 */
export function sortPhotos(items: readonly ImportJob[]): ImportJob[] {
  return [...items].sort((a, b) => a.id - b.id);
}

export interface PauseCopy {
  /** Shown when the API supplies no `pauseReason`. */
  reasonFallback: string;
  hint: string;
  /** Settings link to fix the configuration, or `null` when it lives server-side. */
  settingsHref: string | null;
}

/** Banner copy for a paused queue, keyed by the integration that must be fixed. */
export function pauseCopy(
  source: ImportPauseSource | null,
  t: TranslatorFor<'importProgress'>,
): PauseCopy {
  if (source === 'llm') {
    return {
      reasonFallback: t('pause.llm.reason'),
      hint: t('pause.llm.hint'),
      settingsHref: '/settings',
    };
  }
  if (source === 'igdb') {
    return {
      reasonFallback: t('pause.igdb.reason'),
      hint: t('pause.igdb.hint'),
      settingsHref: null,
    };
  }
  return {
    reasonFallback: t('pause.none.reason'),
    hint: t('pause.none.hint'),
    settingsHref: null,
  };
}

/** The per-photo counts sentence (games committed / flagged for review). */
export function photoCountsLine(
  photo: ImportJob,
  t: TranslatorFor<'importProgress'>,
): string {
  if (photo.status === 'queued') return t('photoCounts.queued');
  if (photo.status === 'processing') return t('photoCounts.processing');
  const counts = jobCounts(photo);
  const parts = [t('photoCounts.added', { count: counts.added })];
  if (counts.flagged > 0) {
    parts.push(t('photoCounts.flagged', { count: counts.flagged }));
  }
  return parts.join(' ');
}

/** Declared vs recognized sentence, plus whether to flag the mismatch. */
export function recognitionLine(
  photo: ImportJob,
  t: TranslatorFor<'importProgress'>,
): {
  text: string;
  mismatch: boolean;
} {
  const recognized = jobCounts(photo).recognized;
  if (photo.declaredCount === null) {
    return {
      text: t('recognition.recognized', { count: recognized }),
      mismatch: false,
    };
  }
  return {
    text: t('recognition.declared', {
      declared: photo.declaredCount,
      recognized,
    }),
    mismatch: photo.declaredCountMismatch,
  };
}

/** A photo the owner must act on: needs review, or failed. (D1) */
export function needsReview(photo: ImportJob): boolean {
  return photo.needsAttention || photo.status === 'failed';
}

/**
 * Resolve a photo's raw platform label to a known platform id for the manual
 * form, or '' when unknown. Case-insensitive match on name or slug.
 */
export function matchPlatformId(
  platforms: readonly GamePlatform[],
  raw: string | null,
): string {
  if (raw === null) return '';
  const target = raw.trim().toLowerCase();
  if (target === '') return '';
  const match = platforms.find(
    (p) =>
      p.name.trim().toLowerCase() === target || p.slug.toLowerCase() === target,
  );
  return match === undefined ? '' : String(match.id);
}
