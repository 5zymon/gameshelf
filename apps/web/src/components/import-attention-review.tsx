'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  isApiError,
  type GameDetail,
  type GamePlatform,
  type ImportJob,
  type UnrecognizedItem,
} from '@/lib/api';
import { api } from '@/lib/api/browser';
import { ManualAddForm } from '@/components/manual-add-form';
import {
  matchPlatformId,
  needsReview,
  photoCountsLine,
  recognitionLine,
  statusView,
  type ProgressTone,
} from '@/lib/import/progress';

const PRIMARY_BUTTON =
  'rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60';
const DANGER_BUTTON =
  'rounded-md border border-danger/40 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-60';
const SMALL_BUTTON =
  'rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60';
const SMALL_DANGER_BUTTON =
  'rounded-md border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-60';

const TONE_TEXT: Readonly<Record<ProgressTone, string>> = {
  muted: 'text-muted',
  active: 'text-accent',
  success: 'text-fog',
  warning: 'text-accent-strong',
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
  photoIndex: ReadonlyMap<number, number>;
  onChanged: () => Promise<void>;
}): React.ReactElement | null {
  const attention = photos.filter(needsReview);
  if (attention.length === 0) return null;
  return (
    <section aria-labelledby="attention-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 id="attention-heading" className="text-lg font-medium text-fog">
          Needs attention
        </h2>
        <p className="text-sm text-muted">
          {String(attention.length)}{' '}
          {attention.length === 1 ? 'photo needs' : 'photos need'} a decision.
          Add the missing games, retry a failed photo, or dismiss what you don’t
          need to act on.
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
  const view = statusView(photo.status);
  const recognition = recognitionLine(photo);
  const [items, setItems] = useState<UnrecognizedItem[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsReloadKey, setItemsReloadKey] = useState(0);
  const [itemBusyId, setItemBusyId] = useState<number | null>(null);
  const [addItemId, setAddItemId] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const failed = photo.status === 'failed';

  const idBase = `attention-${String(photo.id)}`;
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
        setItemsError('We couldn’t load the flagged items for this photo.');
      }
    })();
    return () => {
      controller.abort();
    };
  }, [photo.id, photo.unrecognizedCount, photo.status, router, itemsReloadKey]);

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
          : 'We couldn’t retry this photo. Check your connection and try again.',
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
          : 'We couldn’t dismiss this photo. Check your connection and try again.',
      );
    } finally {
      setDismissing(false);
      setConfirmingDismiss(false);
    }
  }

  async function dismissItem(item: UnrecognizedItem): Promise<boolean> {
    if (itemBusyId !== null) return false;
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
          : 'We couldn’t dismiss this item. Check your connection and try again.',
      );
      return false;
    } finally {
      setItemBusyId(null);
    }
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
      setStatus(
        `Added “${game.title}”. This flagged item is now marked as reviewed.`,
      );
    }
  }

  return (
    <div
      className={`space-y-3 rounded-lg border p-4 ${failed ? 'border-danger/40 bg-danger/5' : 'border-accent-strong/50 bg-accent-strong/5'}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-fog">Photo {photoNumber}</p>
        <span className={`text-xs ${TONE_TEXT[view.tone]}`}>{view.label}</span>
      </div>

      <p className="text-sm text-muted">{photoCountsLine(photo)}</p>
      {!failed && (
        <p
          className={
            recognition.mismatch ? 'text-sm text-danger' : 'text-sm text-muted'
          }
        >
          {recognition.text}
          {photo.declaredCountMismatch && (
            <span className="ml-2 rounded-full border border-danger/40 px-2 py-0.5 text-xs text-danger">
              Count mismatch
            </span>
          )}
        </p>
      )}
      {failed && (
        <p className="text-sm text-danger">
          {photo.errorMessage ?? 'The photo could not be processed.'}
        </p>
      )}

      {photo.unrecognizedCount > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
            Flagged items
          </h3>
          {items === null && itemsError === null && (
            <p role="status" className="text-sm text-muted">
              Loading flagged items…
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
                Try again
              </button>
            </div>
          )}
          {items !== null && items.length === 0 && itemsError === null && (
            <p className="text-sm text-muted">
              All flagged items for this photo have been reviewed.
            </p>
          )}
          {items !== null && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="space-y-2 rounded-md border border-edge bg-ink/40 p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-sm text-fog">{item.rawTitle}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={itemBusyId !== null}
                        onClick={() => {
                          void dismissItem(item);
                        }}
                        className={SMALL_DANGER_BUTTON}
                      >
                        {itemBusyId === item.id ? 'Dismissing…' : 'Dismiss'}
                      </button>
                      <button
                        type="button"
                        aria-expanded={addItemId === item.id}
                        disabled={itemBusyId !== null}
                        onClick={() => {
                          setAddItemId((cur) =>
                            cur === item.id ? null : item.id,
                          );
                          setStatus(null);
                        }}
                        className={SMALL_BUTTON}
                      >
                        {addItemId === item.id ? 'Close' : 'Add manually'}
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
                  {addItemId === item.id && (
                    <div className="rounded-md border border-edge bg-shelf/40 p-3">
                      <ManualAddForm
                        platforms={platforms}
                        initialTitle={item.rawTitle}
                        initialPlatformId={matchPlatformId(
                          platforms,
                          item.rawPlatform,
                        )}
                        submitLabel="Add to catalog"
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
              {retrying ? 'Retrying…' : 'Retry photo'}
            </button>
            <p className="w-full text-xs text-muted">
              Retry re-runs only the games that aren’t saved yet. Games already
              in your catalog won’t be added again.
            </p>
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
            Dismiss photo
          </button>
        )}
      </div>
      {confirmingDismiss && (
        <div
          role="alertdialog"
          aria-labelledby={`${idBase}-title`}
          aria-describedby={`${idBase}-body`}
          className="space-y-2 rounded-md border border-danger/40 bg-danger/5 p-3"
        >
          <p id={`${idBase}-title`} className="text-sm font-medium text-fog">
            Dismiss this photo?
          </p>
          <p id={`${idBase}-body`} className="text-sm text-muted">
            It leaves the review list and can’t be brought back. Its record is
            kept.
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
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void dismissPhoto();
              }}
              disabled={dismissing}
              className={DANGER_BUTTON}
            >
              {dismissing ? 'Dismissing…' : 'Dismiss'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
