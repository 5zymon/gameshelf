'use client';

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
import { ManualAddForm } from '@/components/manual-add-form';
import { sameOriginPath } from '@/lib/image-url';
import {
  matchPlatformId,
  needsReview,
  photoCountsLine,
  recognitionLine,
  statusView,
  type ProgressTone,
} from '@/lib/import/progress';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60';
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';
const DANGER_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-danger/40 px-4 py-2.5 text-sm leading-none font-medium text-danger transition-colors duration-[140ms] ease-[ease] hover:bg-danger/10 motion-reduce:transition-none disabled:opacity-60';
const SMALL_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-3 py-1.5 text-xs leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';
const SMALL_DANGER_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-danger/40 px-3 py-1.5 text-xs leading-none font-medium text-danger transition-colors duration-[140ms] ease-[ease] hover:bg-danger/10 motion-reduce:transition-none disabled:opacity-60';

const TONE_TEXT: Readonly<Record<ProgressTone, string>> = {
  muted: 'text-muted',
  active: 'text-accent-text',
  success: 'text-ink',
  warning: 'text-accent-text',
  danger: 'text-danger',
};

export function ImportAttentionReview({
  photos,
  platforms,
  photoIndex,
  onChanged,
}: {
  photos: readonly ImportJob[];
  platforms: GamePlatform[];
  photoIndex: ReadonlyMap<string, number>;
  onChanged: () => Promise<void>;
}): React.ReactElement | null {
  const t = useTranslations('importAttention');
  const attention = photos.filter(needsReview);
  if (attention.length === 0) return null;
  return (
    <section aria-labelledby="attention-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 id="attention-heading" className="text-lg font-medium text-ink">
          {t('heading')}
        </h2>
        <p className="text-sm text-muted">
          {t('summary', { count: attention.length })}
        </p>
      </div>
      <ul className="space-y-3">
        {attention.map((photo) => (
          <li key={photo.id}>
            <AttentionCard
              photo={photo}
              photoNumber={photoIndex.get(photo.id) ?? 0}
              platforms={platforms}
              onChanged={onChanged}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AttentionCard({
  photo,
  photoNumber,
  platforms,
  onChanged,
}: {
  photo: ImportJob;
  photoNumber: number;
  platforms: GamePlatform[];
  onChanged: () => Promise<void>;
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('importAttention');
  // Status labels, per-photo counts and the "Photo N" heading live in the
  // progress namespace; the flagged-item reload reuses the shared retry label.
  const tProgress = useTranslations('importProgress');
  const tCommon = useTranslations('common');
  const view = statusView(photo.status, tProgress);
  const recognition = recognitionLine(photo, tProgress);
  const [items, setItems] = useState<UnrecognizedItem[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsReloadKey, setItemsReloadKey] = useState(0);
  const [itemBusyId, setItemBusyId] = useState<string | null>(null);
  const [addItemId, setAddItemId] = useState<string | null>(null);
  const [candidateItemId, setCandidateItemId] = useState<string | null>(null);
  const [pickingCandidateKey, setPickingCandidateKey] = useState<string | null>(
    null,
  );
  const [lookupBusyItemId, setLookupBusyItemId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const failed = photo.status === 'failed';
  // Any write in flight for this card's items: one action blocks every other
  // action (and the manual save), so two writes can never race for one item.
  const cardBusy =
    itemBusyId !== null ||
    pickingCandidateKey !== null ||
    lookupBusyItemId !== null;

  const idBase = `attention-${photo.id}`;
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
    if (photo.unrecognizedCount === 0) {
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
  }, [
    photo.id,
    photo.unrecognizedCount,
    photo.status,
    router,
    itemsReloadKey,
    t,
  ]);

  async function retry(): Promise<void> {
    if (retrying) return;
    setRetrying(true);
    setActionError(null);
    setStatus(null);
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

  async function dismissItem(item: UnrecognizedItem): Promise<boolean> {
    if (cardBusy) return false;
    setItemBusyId(item.id);
    setActionError(null);
    try {
      await api.importJobs.dismissUnrecognizedItem(photo.id, item.id);
      setItems(
        (current) => current?.filter((i) => i.id !== item.id) ?? current,
      );
      return true;
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        return false;
      }
      setActionError(
        isApiError(caught) && caught.status !== 0
          ? caught.userMessage
          : t('error.dismissItem'),
      );
      return false;
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
    setPickingCandidateKey(key);
    setActionError(null);
    try {
      await api.importJobs.pickUnrecognizedCandidate(photo.id, item.id, {
        source: candidate.source,
        externalId: candidate.externalId,
      });
      setItems(
        (current) => current?.filter((i) => i.id !== item.id) ?? current,
      );
      setCandidateItemId(null);
      setStatus(t('added', { title: candidate.title }));
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
      setPickingCandidateKey(null);
    }
  }

  function onItemResolved(item: UnrecognizedItem, game: GameDetail): void {
    setItems((current) => current?.filter((i) => i.id !== item.id) ?? current);
    setAddItemId(null);
    setActionError(null);
    setStatus(t('added', { title: game.title }));
  }

  async function onItemSaved(
    item: UnrecognizedItem,
    game: GameDetail,
  ): Promise<void> {
    setAddItemId(null);
    setStatus(null);
    // Claim the item was reviewed only once the dismissal actually persisted;
    // a failed PATCH surfaces through `actionError` alone.
    const dismissed = await dismissItem(item);
    if (dismissed) {
      setStatus(t('added', { title: game.title }));
    }
  }

  return (
    <div
      className={`space-y-3 rounded-control border p-4 ${failed ? 'border-danger/40 bg-danger/5' : 'border-accent/40 bg-accent-soft'}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-ink">
          {tProgress('photo', { n: photoNumber })}
        </p>
        <span className={`text-xs ${TONE_TEXT[view.tone]}`}>{view.label}</span>
      </div>

      <p className="text-sm text-muted">{photoCountsLine(photo, tProgress)}</p>
      {!failed && (
        <p
          className={
            recognition.mismatch ? 'text-sm text-danger' : 'text-sm text-muted'
          }
        >
          {recognition.text}
          {photo.declaredCountMismatch && (
            <span className="ml-2 rounded-full border border-danger/40 px-2 py-0.5 text-xs text-danger">
              {t('countMismatch')}
            </span>
          )}
        </p>
      )}
      {failed && (
        <p className="text-sm text-danger">
          {photo.errorMessage ?? t('error.processing')}
        </p>
      )}

      {photo.unrecognizedCount > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
            {t('flaggedItems')}
          </h3>
          {items === null && itemsError === null && (
            <p role="status" className="text-sm text-muted">
              {t('loading')}
            </p>
          )}
          {itemsError !== null && (
            <div className="flex flex-wrap items-center gap-2">
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
            <p className="text-sm text-muted">{t('allReviewed')}</p>
          )}
          {items !== null && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="space-y-2 rounded-control border border-edge bg-canvas p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-sm text-ink">{item.rawTitle}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={cardBusy}
                        onClick={() => {
                          void dismissItem(item);
                        }}
                        className={SMALL_DANGER_BUTTON}
                      >
                        {itemBusyId === item.id
                          ? t('dismissing')
                          : t('dismiss')}
                      </button>
                      <button
                        type="button"
                        aria-expanded={addItemId === item.id}
                        disabled={cardBusy}
                        onClick={() => {
                          setAddItemId((cur) =>
                            cur === item.id ? null : item.id,
                          );
                          setStatus(null);
                        }}
                        className={SMALL_BUTTON}
                      >
                        {addItemId === item.id ? t('close') : t('addManually')}
                      </button>
                    </div>
                  </div>
                  {(item.rawPlatform !== null || item.reason !== null) && (
                    <p className="text-xs text-muted">
                      {[item.rawPlatform, item.reason]
                        .filter((p): p is string => p !== null && p !== '')
                        .join(' · ')}
                    </p>
                  )}
                  {item.candidates.length > 0 && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        aria-expanded={candidateItemId === item.id}
                        disabled={cardBusy}
                        onClick={() => {
                          setCandidateItemId((cur) =>
                            cur === item.id ? null : item.id,
                          );
                          setStatus(null);
                        }}
                        className={SMALL_BUTTON}
                      >
                        {candidateItemId === item.id
                          ? t('close')
                          : t('candidatesHeading')}
                      </button>
                      {candidateItemId === item.id && (
                        <div className="rounded-control border border-edge bg-surface p-3">
                          <ul className="space-y-2">
                            {item.candidates.map((candidate) => {
                              const key = `${candidate.source}:${String(candidate.externalId)}`;
                              const cover = sameOriginPath(candidate.coverUrl);
                              const isPicking = pickingCandidateKey === key;
                              return (
                                <li
                                  key={key}
                                  className="flex items-center gap-3"
                                >
                                  {cover !== null && (
                                    // eslint-disable-next-line @next/next/no-img-element -- API-served same-origin signed preview
                                    <img
                                      src={cover}
                                      alt={t('coverAlt', {
                                        title: candidate.title,
                                      })}
                                      className="aspect-[3/4] w-12 shrink-0 rounded-control border border-edge object-cover"
                                    />
                                  )}
                                  <div className="min-w-0 flex-1 space-y-0.5">
                                    <p className="truncate text-sm text-ink">
                                      {candidate.title}
                                    </p>
                                    <p className="text-xs text-muted">
                                      {candidate.source}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={cardBusy}
                                    onClick={() => {
                                      void pickCandidate(item, candidate);
                                    }}
                                    className={SMALL_BUTTON}
                                  >
                                    {isPicking ? t('picking') : t('pick')}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {addItemId === item.id && (
                    <div className="rounded-control border border-edge bg-surface p-3">
                      <ManualAddForm
                        platforms={platforms}
                        initialTitle={item.rawTitle}
                        initialPlatformId={matchPlatformId(
                          platforms,
                          item.rawPlatform,
                        )}
                        submitLabel={t('addToCatalog')}
                        disabled={
                          itemBusyId !== null || pickingCandidateKey !== null
                        }
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
                        onSaved={(game) => {
                          void onItemSaved(item, game);
                        }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {actionError !== null && (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      )}
      {status !== null && (
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {status}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {failed && (
          <>
            <button
              type="button"
              onClick={() => {
                void retry();
              }}
              disabled={retrying}
              className={PRIMARY_BUTTON}
            >
              {retrying ? t('retrying') : t('retry')}
            </button>
            <p className="w-full text-xs text-muted">{t('retryHint')}</p>
          </>
        )}
        {!confirmingDismiss && (
          <button
            ref={dismissTriggerRef}
            type="button"
            onClick={() => {
              setConfirmingDismiss(true);
              setActionError(null);
            }}
            disabled={dismissing}
            className={DANGER_BUTTON}
          >
            {t('dismissPhoto')}
          </button>
        )}
      </div>
      {confirmingDismiss && (
        <div
          role="alertdialog"
          aria-labelledby={`${idBase}-title`}
          aria-describedby={`${idBase}-body`}
          className="space-y-2 rounded-control border border-danger/40 bg-danger/5 p-3"
        >
          <p id={`${idBase}-title`} className="text-sm font-medium text-ink">
            {t('confirmTitle')}
          </p>
          <p id={`${idBase}-body`} className="text-sm text-muted">
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
              {dismissing ? t('dismissing') : t('dismiss')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
