import type { TranslatorFor } from '@/i18n/translate';
import type {
  GamePlatform,
  ImportBatchProgress,
  ImportJob,
  ImportJobStatus,
  ImportPauseSource,
  UnrecognizedItem,
} from '@/lib/api';

/** API token for a title with no usable platform name (photo-import-pipeline.service.ts PLATFORM_NOT_IN_CATALOG_REASON). */
export const PLATFORM_NOT_IN_CATALOG_REASON = 'platform_not_in_catalog';

/** One state per photo; `needs_attention` is split by what still needs a decision. */
export type PhotoState =
  | 'queued'
  | 'processing'
  | 'failed'
  | 'unmatched'
  | 'nothingFound'
  | 'countMismatch'
  | 'ready'
  | 'dismissed';

export function isTerminalStatus(status: ImportJobStatus): boolean {
  return status !== 'queued' && status !== 'processing';
}

/**
 * One state per photo. `needs_attention` is split by what still needs a
 * decision; a `needs_attention` row with nothing open and no other trigger
 * (a pre-fix row) reads as ready.
 */
export function photoState(photo: ImportJob): PhotoState {
  switch (photo.status) {
    case 'queued':
      return 'queued';
    case 'processing':
      return 'processing';
    case 'failed':
      return 'failed';
    case 'dismissed':
      return 'dismissed';
    case 'done':
      return 'ready';
    case 'needs_attention':
      if (photo.openFlaggedCount > 0) return 'unmatched';
      if (photo.recognizedCount === 0) return 'nothingFound';
      if (photo.declaredCountMismatch) return 'countMismatch';
      return 'ready';
  }
}

export function needsDecision(state: PhotoState): boolean {
  return (
    state === 'failed' ||
    state === 'unmatched' ||
    state === 'nothingFound' ||
    state === 'countMismatch'
  );
}

/** Mirrors the API dismissJob guard. */
export function canDismissPhoto(photo: ImportJob): boolean {
  return photo.status === 'needs_attention' || photo.status === 'failed';
}

export interface PhotoReviewCounts {
  added: number;
  open: number;
  reviewed: number;
}

export function photoReviewCounts(photo: ImportJob): PhotoReviewCounts {
  return {
    added: photo.importedCount,
    open: photo.status === 'dismissed' ? 0 : photo.openFlaggedCount,
    reviewed: Math.max(0, photo.unrecognizedCount - photo.openFlaggedCount),
  };
}

export interface BatchCounts {
  added: number;
  toReview: number;
  failed: number;
}

export function batchCounts(
  items: readonly ImportJob[],
  progress: ImportBatchProgress,
): BatchCounts {
  let added = 0;
  let toReview = 0;
  for (const item of items) {
    const c = photoReviewCounts(item);
    added += c.added;
    toReview += c.open;
  }
  return { added, toReview, failed: progress.failed };
}

export type MismatchDirection = 'fewer' | 'more';

export function mismatchDirection(photo: ImportJob): MismatchDirection {
  return (photo.declaredCount ?? 0) > photo.recognizedCount ? 'fewer' : 'more';
}

export type FlaggedItemReason = 'ambiguous' | 'noPlatform' | 'notFound';

/** Plain-language category; the raw `reason` (provider text) is never shown. */
export function flaggedItemReason(item: UnrecognizedItem): FlaggedItemReason {
  if (item.candidates.length > 0) return 'ambiguous';
  if (item.reason === PLATFORM_NOT_IN_CATALOG_REASON) return 'noPlatform';
  return 'notFound';
}

/**
 * Photos ordered by ascending id (UUIDv7 = upload order). The API stores no
 * original filename and `photoRef` is opaque, so the stable id order is what
 * "Photo 1, Photo 2 …" means.
 */
export function sortPhotos(items: readonly ImportJob[]): ImportJob[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
  return match === undefined ? '' : match.id;
}
