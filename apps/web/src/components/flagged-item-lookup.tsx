'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { isApiError, type EnrichCandidate, type GameDetail } from '@/lib/api';
import { sameOriginPath } from '@/lib/image-url';

const SMALL_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-3 py-1.5 text-xs leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';

/**
 * How the flagged-item review wires the catalog lookup to its own endpoints
 * (`GET …/unrecognized/:itemId/search` and `POST …/pick`). Kept as a prop so
 * the lookup component stays free of route/job/item knowledge and can be
 * unit-rendered with a fake.
 */
export interface CatalogLookup {
  search(
    q: string,
    platformId: string | undefined,
    signal: AbortSignal,
  ): Promise<EnrichCandidate[]>;
  pick(
    candidate: EnrichCandidate,
    query: string,
    platformId: string | undefined,
  ): Promise<GameDetail>;
  onPicked(game: GameDetail): void;
}

/**
 * "Search again" for a flagged item: searches the game database with the
 * (corrected) title from the manual-add form, lists the matches with the ones
 * on the form's platform first, and hands a picked match back to the parent
 * (which removes the item and reports the added game). The pick re-confirms
 * with the **searched** query and platform, not the live form values, so it
 * matches what the user saw.
 */
export function FlaggedItemLookup({
  lookup,
  title,
  platformId,
  disabled,
  onBusyChange,
}: {
  lookup: CatalogLookup;
  title: string;
  platformId: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('importAttention');
  const [results, setResults] = useState<{
    query: string;
    platformId: string | undefined;
    candidates: EnrichCandidate[];
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Abort the in-flight search on unmount. `lookup` is deliberately not a
  // dependency: the parent re-creates the object on every render, and the
  // cleanup only owns the controller ref.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const q = title.trim();
  const preferredPlatformId = platformId === '' ? undefined : platformId;

  async function runSearch(): Promise<void> {
    if (q.length < 2 || searching || pickingKey !== null || disabled) return;
    // No abort of a previous search here: the `searching` guard above makes a
    // concurrent search impossible; only unmount aborts (see the effect).
    const controller = new AbortController();
    controllerRef.current = controller;
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const candidates = await lookup.search(
        q,
        preferredPlatformId,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setResults({
          query: q,
          platformId: preferredPlatformId,
          candidates,
        });
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        return;
      }
      setError(
        isApiError(caught) && caught.status !== 0 && caught.status !== 503
          ? caught.userMessage
          : t('lookup.error.search'),
      );
    } finally {
      // Only unmount can abort now (the guard prevents a supersede), but the
      // check keeps an aborted request from touching a dead component.
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  async function pick(candidate: EnrichCandidate): Promise<void> {
    if (disabled || pickingKey !== null || results === null) return;
    const key = `${candidate.source}:${String(candidate.externalId)}`;
    setPickingKey(key);
    setError(null);
    onBusyChange(true);
    try {
      // Send the query and platform the list was searched with, not the live
      // form values: the re-confirm must match what the user picked from.
      const game = await lookup.pick(
        candidate,
        results.query,
        results.platformId,
      );
      lookup.onPicked(game);
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        return;
      }
      // 503 (and network 0) show the generic retry message, never the raw
      // source reason — the same rule as the search path above.
      setError(
        isApiError(caught) && caught.status !== 0 && caught.status !== 503
          ? caught.userMessage
          : t('error.pick'),
      );
    } finally {
      setPickingKey(null);
      onBusyChange(false);
    }
  }

  const statusText =
    results === null
      ? null
      : results.candidates.length > 0
        ? t('lookup.results', {
            count: results.candidates.length,
            title: results.query,
          })
        : t('lookup.noMatches', { title: results.query });

  return (
    <div className="space-y-2 border-t border-edge-soft pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          disabled={
            q.length < 2 || searching || pickingKey !== null || disabled
          }
          onClick={() => {
            void runSearch();
          }}
          className={SMALL_BUTTON}
        >
          {searching ? t('lookup.searching') : t('lookup.search')}
        </button>
        <p className="min-w-0 flex-1 basis-60 text-xs text-muted">
          {q.length < 2 ? t('lookup.titleTooShort') : t('lookup.hint')}
        </p>
      </div>
      {/* Persistent live regions, filled in place: a region that mounts
          together with its text is often not announced. `sr-only` keeps the
          empty container in the accessibility tree without a visual gap. */}
      <p
        role="alert"
        className={error === null ? 'sr-only' : 'text-sm text-danger'}
      >
        {error ?? ''}
      </p>
      <p
        role="status"
        aria-live="polite"
        className={statusText === null ? 'sr-only' : 'text-sm text-muted'}
      >
        {statusText ?? ''}
      </p>
      {results !== null && results.candidates.length > 0 && (
        <ul className="space-y-2">
          {results.candidates.map((candidate) => {
            const key = `${candidate.source}:${String(candidate.externalId)}`;
            const cover = sameOriginPath(candidate.coverUrl);
            const isPicking = pickingKey === key;
            const meta = [
              candidate.releaseYear === null
                ? null
                : String(candidate.releaseYear),
              candidate.platforms
                .map((platform) => platform.abbreviation ?? platform.name)
                .join(', '),
            ]
              .filter((part): part is string => part !== null && part !== '')
              .join(' · ');
            return (
              <li key={key} className="flex items-center gap-3">
                {cover !== null && (
                  // eslint-disable-next-line @next/next/no-img-element -- API-served same-origin signed preview
                  <img
                    src={cover}
                    alt={t('coverAlt', { title: candidate.title })}
                    className="aspect-[3/4] w-12 shrink-0 rounded-control border border-edge object-cover"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm text-ink">{candidate.title}</p>
                  {meta !== '' && <p className="text-xs text-muted">{meta}</p>}
                </div>
                <button
                  type="button"
                  disabled={disabled || pickingKey !== null}
                  onClick={() => {
                    void pick(candidate);
                  }}
                  className={SMALL_BUTTON}
                >
                  {isPicking ? t('picking') : t('pick')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
