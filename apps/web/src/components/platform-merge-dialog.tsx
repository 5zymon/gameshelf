'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { isApiError, type Platform } from '@/lib/api';
import { api } from '@/lib/api/browser';
import { mergeConfirmation, platformErrorMessage } from '@/lib/platforms';

const FIELD =
  'w-full rounded-md border border-edge bg-ink px-3 py-2 text-fog outline-none focus-visible:ring-2 focus-visible:ring-accent';
const LABEL = 'block text-sm text-muted';
const PRIMARY_BUTTON =
  'rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60';

interface Preview {
  total: number;
  titles: string[];
}

const PREVIEW_TITLES = 10;

export function PlatformMergeDialog({
  source,
  platforms,
  onClose,
  onMerged,
}: {
  source: Platform;
  platforms: readonly Platform[];
  onClose: () => void;
  onMerged: () => void;
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('platforms');
  const uid = useId();
  const headingId = `${uid}-heading`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  // Hidden reference platforms make poor merge targets: merging into one moves
  // the games where the list does not show them.
  const targets = platforms.filter((p) => p.id !== source.id && !p.hidden);
  const [targetId, setTargetId] = useState(() =>
    targets[0] === undefined ? '' : String(targets[0].id),
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const target = targets.find((p) => String(p.id) === targetId);
  const total = preview?.total ?? source.gameCount;
  const shownTitles =
    preview === null ? [] : preview.titles.slice(0, PREVIEW_TITLES);
  const remaining = preview === null ? 0 : preview.total - shownTitles.length;

  // Capture the trigger before focus moves; restore it once the dialog closes
  // (unless the row was removed by the merge, in which case it is detached).
  useEffect(() => {
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      if (trigger !== null && document.contains(trigger)) trigger.focus();
    };
  }, []);

  useEffect(() => {
    if (selectRef.current !== null) {
      selectRef.current.focus();
      return;
    }
    // No targets (no select): land on the first control so the Tab trap holds.
    const firstControl = dialogRef.current?.querySelector<HTMLElement>(
      'button:not([disabled])',
    );
    (firstControl ?? dialogRef.current)?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.games.list(
          { platformId: source.id, limit: 100 },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setPreview({
          total: response.meta.total,
          titles: response.items.map((item) => item.title),
        });
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (isApiError(caught) && caught.status === 401) {
          router.replace('/login');
          router.refresh();
          return;
        }
        // Degrade to `source.gameCount` rather than blocking the merge.
        setPreviewFailed(true);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [source.id, router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !merging) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [merging, onClose]);

  async function merge(): Promise<void> {
    if (target === undefined || merging || unavailable) return;
    setMerging(true);
    setError(null);
    try {
      await api.platforms.merge(source.id, { targetId: target.id });
      onMerged();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      if (isApiError(caught) && caught.status === 404) {
        setUnavailable(true);
        setError(t('error.notFound'));
        return;
      }
      setError(platformErrorMessage(caught, t('error.merge')));
    } finally {
      setMerging(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/80 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !merging) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="w-full max-w-lg space-y-4 rounded-xl border border-edge bg-shelf p-4 outline-none sm:p-6"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const node = dialogRef.current;
          if (node === null) return;
          const focusables = Array.from(
            node.querySelectorAll<HTMLElement>(
              'select:not([disabled]), button:not([disabled])',
            ),
          );
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (first === undefined || last === undefined) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 id={headingId} className="text-lg font-medium text-fog">
          {t('merge.title', { name: source.name })}
        </h2>

        {previewFailed ? (
          <p className="text-sm text-muted">
            {t('merge.willMove', { count: source.gameCount })}
          </p>
        ) : preview === null ? (
          <p role="status" className="text-sm text-muted">
            {t('merge.loading')}
          </p>
        ) : (
          <div className="space-y-2 rounded-lg border border-edge bg-ink/40 p-3">
            <p className="text-sm text-muted">
              {t('merge.move', {
                count: preview.total,
                source: source.name,
              })}
            </p>
            {shownTitles.length > 0 && (
              <ul className="list-inside list-disc text-xs text-muted">
                {shownTitles.map((title, index) => (
                  <li key={`${String(index)}-${title}`}>{title}</li>
                ))}
              </ul>
            )}
            {remaining > 0 && (
              <p className="text-xs text-muted">
                {t('merge.more', { count: remaining })}
              </p>
            )}
          </div>
        )}

        {targets.length === 0 ? (
          <p className="text-sm text-muted">{t('merge.none')}</p>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-target`} className={LABEL}>
              {t('merge.into')}
            </label>
            <select
              id={`${uid}-target`}
              ref={selectRef}
              value={targetId}
              onChange={(event) => {
                setTargetId(event.target.value);
              }}
              className={FIELD}
            >
              {targets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {target !== undefined && (
          <p className="text-sm text-fog">
            {mergeConfirmation(source.name, target.name, total, t)}
          </p>
        )}

        {error !== null && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {unavailable ? (
            <button type="button" onClick={onMerged} className={PRIMARY_BUTTON}>
              {t('merge.close')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={merging}
                className={SECONDARY_BUTTON}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void merge();
                }}
                disabled={target === undefined || merging || unavailable}
                className={PRIMARY_BUTTON}
              >
                {merging ? t('merging') : t('merge.button')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
