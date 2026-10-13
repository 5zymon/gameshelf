'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  isApiError,
  type GameDetail,
  type GamePlatform,
  type ImportJob,
  type UnrecognizedItem,
  type UnrecognizedItemCandidate,
} from '@/lib/api';
import { api } from '@/lib/api/browser';
import {
  ManualAddForm,
  type ManualAddIntent,
} from '@/components/manual-add-form';
import { sameOriginPath } from '@/lib/image-url';
import {
  canDismissPhoto,
  flaggedItemReason,
  isTerminalStatus,
  matchPlatformId,
  mismatchDirection,
  needsDecision,
  photoReviewCounts,
  photoState,
  type PhotoState,
} from '@/lib/import/progress';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60';
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';
const DANGER_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-danger/40 px-4 py-2.5 text-sm leading-none font-medium text-danger transition-colors duration-[140ms] ease-[ease] hover:bg-danger/10 motion-reduce:transition-none disabled:opacity-60';
const SMALL_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-3 py-1.5 text-xs leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';
const SMALL_QUIET_DANGER =
  'inline-flex items-center justify-center rounded-control px-3 py-1.5 text-xs leading-none font-medium text-danger transition-colors duration-[140ms] ease-[ease] hover:bg-danger/10 motion-reduce:transition-none disabled:opacity-60';

type ChipLabel =
  'queued' | 'processing' | 'failed' | 'decision' | 'ready' | 'dismissed';

const CHIP: Readonly<
  Record<PhotoState, { label: ChipLabel; text: string; dot: string }>
> = {
  queued: { label: 'queued', text: 'text-muted', dot: 'bg-edge-strong' },
  processing: {
    label: 'processing',
    text: 'text-accent-text',
    dot: 'bg-accent animate-pulse motion-reduce:animate-none',
  },
  failed: { label: 'failed', text: 'text-danger', dot: 'bg-danger' },
  unmatched: { label: 'decision', text: 'text-accent-text', dot: 'bg-accent' },
  nothingFound: {
    label: 'decision',
    text: 'text-accent-text',
    dot: 'bg-accent',
  },
  countMismatch: {
    label: 'decision',
    text: 'text-accent-text',
    dot: 'bg-accent',
  },
  ready: { label: 'ready', text: 'text-ink', dot: 'bg-ink' },
  dismissed: { label: 'dismissed', text: 'text-muted', dot: 'bg-edge-strong' },
};

const BAR = 'before:absolute before:inset-y-0 before:left-0 before:w-1';
const DECISION_BAR: Readonly<Partial<Record<PhotoState, string>>> = {
  failed: `${BAR} before:bg-danger`,
  unmatched: `${BAR} before:bg-accent`,
  nothingFound: `${BAR} before:bg-accent`,
  countMismatch: `${BAR} before:bg-accent`,
};

export function ImportPhotoReview({
  photos,
  platforms,
  photoIndex,
  onChanged,
}: {
  photos: readonly ImportJob[];
  platforms: GamePlatform[];
  photoIndex: ReadonlyMap<string, number>;
  onChanged: () => Promise<void>;
}): React.ReactElement {
  const t = useTranslations('importAttention');
  const tProgress = useTranslations('importProgress');
  const entries = photos.map((photo) => ({ photo, state: photoState(photo) }));
  const decisions = entries.filter((entry) => needsDecision(entry.state));
  const working = entries.some(
    (entry) => entry.state === 'queued' || entry.state === 'processing',
  );
  const summary =
    decisions.length > 0
      ? t('summary.decision', { count: decisions.length })
      : working
        ? t('summary.working')
        : t('summary.allDone');
  return (
    <section aria-labelledby="import-photos-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 id="import-photos-heading" className="text-lg font-medium text-ink">
          {tProgress('photos')}
        </h2>
        <p className="text-sm text-muted">{summary}</p>
        {decisions.length > 0 && (
          <ul
            aria-label={t('jumpTo')}
            className="flex flex-wrap gap-x-3 gap-y-1 pt-1"
          >
            {decisions.map(({ photo }) => (
              <li key={photo.id}>
                <a
                  href={`#import-photo-${photo.id}`}
                  className="text-sm font-medium text-accent-text underline-offset-4 hover:underline"
                >
                  {tProgress('photo', { n: photoIndex.get(photo.id) ?? 0 })}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ul className="divide-y divide-edge overflow-hidden rounded-card border border-edge bg-surface shadow-[var(--shadow-card)]">
        {entries.map(({ photo, state }) => (
          <PhotoReviewCard
            key={photo.id}
            photo={photo}
            state={state}
            photoNumber={photoIndex.get(photo.id) ?? 0}
            platforms={platforms}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </section>
  );
}

function PhotoReviewCard({
  photo,
  state,
  photoNumber,
  platforms,
  onChanged,
}: {
  photo: ImportJob;
  state: PhotoState;
  photoNumber: number;
  platforms: GamePlatform[];
  onChanged: () => Promise<void>;
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('importAttention');
  // "Photo N", the photos heading and the shared retry label live in the
  // progress namespace; "Add a game by hand" is shared with the import page.
  const tProgress = useTranslations('importProgress');
  const tCommon = useTranslations('common');
  const tImport = useTranslations('import');
  const [items, setItems] = useState<UnrecognizedItem[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsReloadKey, setItemsReloadKey] = useState(0);
  const [itemBusyId, setItemBusyId] = useState<string | null>(null);
  const [addItemId, setAddItemId] = useState<string | null>(null);
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const [lookupBusyItemId, setLookupBusyItemId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const decision = needsDecision(state);
  // Any write in flight for this card's items: one action blocks every other
  // action (and the manual save), so two writes can never race for one item.
  const cardBusy =
    itemBusyId !== null ||
    pickingKey !== null ||
    lookupBusyItemId !== null ||
    retrying ||
    dismissing;
  // Load the flagged titles only while there is something to review; once the
  // photo settles there is nothing to fetch, and refetching then would drop
  // the "all reviewed" state back to loading on every poll.
  const loadItems =
    isTerminalStatus(photo.status) &&
    photo.status !== 'dismissed' &&
    photo.openFlaggedCount > 0;
  const showItems = loadItems || (items !== null && items.length > 0);

  const idBase = `import-photo-${photo.id}`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dismissTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);

  // Focus the least-destructive action when the confirmation opens.
  useEffect(() => {
    if (confirmingDismiss) cancelRef.current?.focus();
  }, [confirmingDismiss]);

  // On cancel the focused Cancel button unmounts; return focus to the trigger
  // instead of letting it fall to <body>.
  useEffect(() => {
    if (!confirmingDismiss && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      dismissTriggerRef.current?.focus();
    }
  }, [confirmingDismiss]);

  // Escape cancels the inline confirmation.
  useEffect(() => {
    if (!confirmingDismiss) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        restoreFocusRef.current = true;
        setConfirmingDismiss(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [confirmingDismiss]);

  useEffect(() => {
    if (!loadItems) {
      setItems([]);
      setItemsError(null);
      return;
    }
    const controller = new AbortController();
    setItems(null);
    setItemsError(null);
    void (async () => {
      try {
        const list = await api.importJobs.listUnrecognized(photo.id, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setItems(list);
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (isApiError(caught) && caught.status === 401) {
          router.replace('/login');
          return;
        }
        setItemsError(t('loadError'));
      }
    })();
    return () => {
      controller.abort();
    };
  }, [photo.id, loadItems, itemsReloadKey, router, t]);

  async function retry(): Promise<void> {
    if (retrying) return;
    setRetrying(true);
    setActionError(null);
    setStatus(null);
    setConfirmingDismiss(false);
    try {
      await api.importJobs.retry(photo.id);
      await onChanged();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        return;
      }
      setActionError(
        isApiError(caught) && caught.status !== 0
          ? caught.userMessage
          : t('error.retry'),
      );
    } finally {
      setRetrying(false);
    }
  }

  async function dismissPhoto(): Promise<void> {
    if (dismissing) return;
    setDismissing(true);
    setActionError(null);
    try {
      await api.importJobs.dismiss(photo.id);
      await onChanged();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        return;
      }
      setActionError(
        isApiError(caught) && caught.status !== 0
          ? caught.userMessage
          : t('error.dismissPhoto'),
      );
    } finally {
      setDismissing(false);
      setConfirmingDismiss(false);
    }
  }

  function removeItem(item: UnrecognizedItem): void {
    setItems((current) => current?.filter((i) => i.id !== item.id) ?? current);
    setAddItemId((current) => (current === item.id ? null : current));
    // The removed row's buttons unmount; keep the keyboard user on the photo
    // instead of letting focus fall to <body>.
    requestAnimationFrame(() => {
      if (
        document.activeElement === null ||
        document.activeElement === document.body
      ) {
        headingRef.current?.focus();
      }
    });
  }

  async function dismissItem(
    item: UnrecognizedItem,
    successMessage: string,
    afterSaveTitle?: string,
  ): Promise<void> {
    // The busy guard keeps user-initiated actions from racing, but it must
    // never swallow the dismiss that finishes a successful manual save: the
    // game already exists, so the item has to be resolved either way.
    if (cardBusy && afterSaveTitle === undefined) return;
    setItemBusyId(item.id);
    setActionError(null);
    setStatus(null);
    try {
      await api.importJobs.dismissUnrecognizedItem(photo.id, item.id);
      removeItem(item);
      setStatus(successMessage);
      void onChanged();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        return;
      }
      setActionError(
        afterSaveTitle !== undefined
          ? t('error.savedDismissFailed', { title: afterSaveTitle })
          : isApiError(caught) && caught.status !== 0
            ? caught.userMessage
            : t('error.dismissItem'),
      );
    } finally {
      setItemBusyId(null);
    }
  }

  async function pickCandidate(
    item: UnrecognizedItem,
    candidate: UnrecognizedItemCandidate,
  ): Promise<void> {
    const key = `${candidate.source}:${String(candidate.externalId)}`;
    if (cardBusy) return;
    setPickingKey(key);
    setActionError(null);
    try {
      await api.importJobs.pickUnrecognizedCandidate(photo.id, item.id, {
        source: candidate.source,
        externalId: candidate.externalId,
      });
      removeItem(item);
      setStatus(t('added', { title: candidate.title }));
      void onChanged();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        return;
      }
      setActionError(
        isApiError(caught) && caught.status !== 0
          ? caught.userMessage
          : t('error.pick'),
      );
    } finally {
      setPickingKey(null);
    }
  }

  function onItemResolved(item: UnrecognizedItem, game: GameDetail): void {
    removeItem(item);
    setActionError(null);
    setStatus(t('added', { title: game.title }));
    void onChanged();
  }

  function onItemSaved(
    item: UnrecognizedItem,
    game: GameDetail,
    intent: ManualAddIntent,
  ): void {
    if (intent === 'save-and-add-another') {
      // The game is in the catalog and the item stays open for the next game;
      // the form shows its own "Added …" confirmation.
      return;
    }
    void dismissItem(item, t('added', { title: game.title }), game.title);
  }

  function summaryLine(): string {
    const counts = photoReviewCounts(photo);
    if (state === 'queued') return t('photoSummary.queued');
    if (state === 'processing') return t('photoSummary.processing');
    if (state === 'nothingFound') return t('photoSummary.nothingFound');
    const parts = [t('photoSummary.added', { count: counts.added })];
    if (counts.open > 0) {
      parts.push(t('photoSummary.open', { count: counts.open }));
    }
    if (counts.reviewed > 0) {
      parts.push(t('photoSummary.reviewed', { count: counts.reviewed }));
    }
    if (state === 'dismissed') parts.push(t('photoSummary.dismissed'));
    return parts.join(' ');
  }

  function whyLine(): string | null {
    switch (state) {
      case 'failed':
        return t('why.failed');
      case 'unmatched':
        return t('why.unmatched');
      case 'nothingFound':
        return t('why.nothingFound');
      case 'countMismatch':
        return t(
          mismatchDirection(photo) === 'fewer'
            ? 'why.countFewer'
            : 'why.countMore',
          {
            declared: photo.declaredCount ?? 0,
            recognized: photo.recognizedCount,
          },
        );
      default:
        return null;
    }
  }

  const summary = summaryLine();
  const why = whyLine();

  return (
    <li
      id={`import-photo-${photo.id}`}
      className={`relative scroll-mt-24 px-4 sm:px-5 ${decision ? 'py-4' : 'py-3'} ${DECISION_BAR[state] ?? ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-semibold text-ink outline-none"
        >
          {tProgress('photo', { n: photoNumber })}
        </h3>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium ${CHIP[state].text}`}
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${CHIP[state].dot}`}
          />
          {t(`state.${CHIP[state].label}`)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{summary}</p>
      {why !== null && (
        <p className="mt-2 max-w-prose text-sm text-ink">{why}</p>
      )}
      {state === 'failed' && photo.errorMessage !== null && (
        <details className="mt-1 text-xs text-muted">
          <summary className="cursor-pointer select-none">
            {t('technicalDetails')}
          </summary>
          <p className="mt-1 break-words">{photo.errorMessage}</p>
        </details>
      )}

      {showItems && (
        <div className="mt-3 border-t border-edge-soft">
          {items === null && itemsError === null && (
            <p role="status" className="pt-3 text-sm text-muted">
              {t('loading')}
            </p>
          )}
          {itemsError !== null && (
            <div className="flex flex-wrap items-center gap-2 pt-3">
              <p role="alert" className="text-sm text-danger">
                {itemsError}
              </p>
              <button
                type="button"
                onClick={() => {
                  setItemsReloadKey((key) => key + 1);
                }}
                className={SMALL_BUTTON}
              >
                {tCommon('tryAgain')}
              </button>
            </div>
          )}
          {items !== null && items.length === 0 && itemsError === null && (
            <p className="pt-3 text-sm text-muted">{t('allReviewed')}</p>
          )}
          {items !== null && items.length > 0 && (
            <ul className="divide-y divide-edge-soft">
              {items.map((item) => {
                const titleId = `${idBase}-item-${item.id}`;
                const panelId = `${idBase}-panel-${item.id}`;
                const open = addItemId === item.id;
                return (
                  <li key={item.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p
                          id={titleId}
                          className="break-words text-sm font-medium text-ink"
                        >
                          {item.rawTitle}
                        </p>
                        <p className="text-xs text-muted">
                          {t(`item.reason.${flaggedItemReason(item)}`)}
                          {item.rawPlatform !== null &&
                            item.rawPlatform !== '' && (
                              <>
                                {' '}
                                {t('item.platform', {
                                  platform: item.rawPlatform,
                                })}
                              </>
                            )}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={open ? panelId : undefined}
                          aria-describedby={titleId}
                          disabled={cardBusy}
                          onClick={() => {
                            setAddItemId((current) =>
                              current === item.id ? null : item.id,
                            );
                            setStatus(null);
                          }}
                          className={SMALL_BUTTON}
                        >
                          {open ? t('close') : t('addManually')}
                        </button>
                        <button
                          type="button"
                          aria-describedby={titleId}
                          disabled={cardBusy}
                          onClick={() => {
                            void dismissItem(
                              item,
                              t('itemDismissed', { title: item.rawTitle }),
                            );
                          }}
                          className={SMALL_QUIET_DANGER}
                        >
                          {itemBusyId === item.id
                            ? t('dismissing')
                            : t('dismiss')}
                        </button>
                      </div>
                    </div>
                    {item.candidates.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {item.candidates.map((candidate) => {
                          const key = `${candidate.source}:${String(candidate.externalId)}`;
                          const candidateId = `${titleId}-${key}`;
                          const cover = sameOriginPath(candidate.coverUrl);
                          return (
                            <li key={key} className="flex items-center gap-3">
                              {cover !== null && (
                                // eslint-disable-next-line @next/next/no-img-element -- API-served same-origin signed preview
                                <img
                                  src={cover}
                                  alt={t('coverAlt', {
                                    title: candidate.title,
                                  })}
                                  className="aspect-[3/4] w-9 shrink-0 rounded-[6px] border border-edge object-cover"
                                />
                              )}
                              <p
                                id={candidateId}
                                className="min-w-0 flex-1 truncate text-sm text-ink"
                              >
                                {candidate.title}
                              </p>
                              <button
                                type="button"
                                aria-describedby={candidateId}
                                disabled={cardBusy}
                                onClick={() => {
                                  void pickCandidate(item, candidate);
                                }}
                                className={SMALL_BUTTON}
                              >
                                {pickingKey === key ? t('picking') : t('pick')}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {open && (
                      <div
                        id={panelId}
                        className="mt-3 border-l-2 border-accent/50 pl-4"
                      >
                        <ManualAddForm
                          variant="compact"
                          platforms={platforms}
                          initialTitle={item.rawTitle}
                          initialPlatformId={matchPlatformId(
                            platforms,
                            item.rawPlatform,
                          )}
                          submitLabel={t('addToCatalog')}
                          disabled={itemBusyId !== null || pickingKey !== null}
                          onLookupBusyChange={(busy) => {
                            setLookupBusyItemId(busy ? item.id : null);
                          }}
                          catalogLookup={{
                            search: async (q, platformId, signal) =>
                              (
                                await api.importJobs.searchUnrecognizedItem(
                                  photo.id,
                                  item.id,
                                  { q, platformId },
                                  { signal },
                                )
                              ).candidates,
                            pick: (candidate, query, platformId) =>
                              api.importJobs.pickUnrecognizedCandidate(
                                photo.id,
                                item.id,
                                {
                                  source: candidate.source,
                                  externalId: candidate.externalId,
                                  query,
                                  platformId,
                                },
                              ),
                            onPicked: (game) => {
                              onItemResolved(item, game);
                            },
                          }}
                          onSaved={(game, intent) => {
                            onItemSaved(item, game, intent);
                          }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <p
        role="alert"
        className={
          actionError === null ? 'sr-only' : 'mt-2 text-sm text-danger'
        }
      >
        {actionError ?? ''}
      </p>
      <p
        role="status"
        aria-live="polite"
        className={status === null ? 'sr-only' : 'mt-2 text-sm text-muted'}
      >
        {status ?? ''}
      </p>

      {decision && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {state === 'failed' && (
            <button
              type="button"
              onClick={() => {
                void retry();
              }}
              disabled={cardBusy}
              className={PRIMARY_BUTTON}
            >
              {retrying ? t('retrying') : t('retry')}
            </button>
          )}
          {state === 'countMismatch' && (
            <Link href="/games/new" className={SECONDARY_BUTTON}>
              {tImport('addByHand')}
            </Link>
          )}
          {canDismissPhoto(photo) && !confirmingDismiss && (
            <button
              ref={dismissTriggerRef}
              type="button"
              onClick={() => {
                setConfirmingDismiss(true);
                setActionError(null);
              }}
              disabled={cardBusy}
              className={DANGER_BUTTON}
            >
              {t('dismissPhoto')}
            </button>
          )}
        </div>
      )}
      {confirmingDismiss && canDismissPhoto(photo) && (
        <div
          role="alertdialog"
          aria-labelledby={`${idBase}-title`}
          aria-describedby={`${idBase}-body`}
          className="mt-3 space-y-2 border-l-2 border-danger/60 pl-4"
        >
          <p id={`${idBase}-title`} className="text-sm font-medium text-ink">
            {t('confirmTitle', { n: photoNumber })}
          </p>
          <p id={`${idBase}-body`} className="max-w-prose text-sm text-muted">
            {t('confirmBody')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={() => {
                restoreFocusRef.current = true;
                setConfirmingDismiss(false);
              }}
              disabled={dismissing}
              className={SECONDARY_BUTTON}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                void dismissPhoto();
              }}
              disabled={dismissing}
              className={DANGER_BUTTON}
            >
              {dismissing ? t('dismissing') : t('dismissPhoto')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
