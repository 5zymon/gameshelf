'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { isApiError, type EnrichCandidate } from '@/lib/api';
import { api } from '@/lib/api/browser';

type Phase = 'idle' | 'searching' | 'matched' | 'applying' | 'done';

/** Same-origin only: the API's preview cover is a root-relative path. */
function sameOriginPath(url: string | null): string | null {
  return url !== null && url.startsWith('/') && !url.startsWith('//')
    ? url
    : null;
}

export function ReEnrichControl({
  gameId,
  title,
}: {
  gameId: number;
  title: string;
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('reEnrich');
  // The candidate cover alt reuses the detail view's translated description.
  const tDetail = useTranslations('gameDetail');
  const [phase, setPhase] = useState<Phase>('idle');
  const [candidate, setCandidate] = useState<EnrichCandidate | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === 'searching' || phase === 'applying';
  const cover = candidate === null ? null : sameOriginPath(candidate.coverUrl);
  const candidateMetaParts =
    candidate === null
      ? []
      : [
          candidate.releaseYear === null ? null : String(candidate.releaseYear),
          candidate.publisher,
          candidate.genre,
          candidate.playerCount === null
            ? null
            : t('players', { count: candidate.playerCount }),
        ].filter((part): part is string => part !== null && part !== '');

  async function handleSearch(): Promise<void> {
    setPhase('searching');
    setError(null);
    setOutcome(null);
    setCandidate(null);
    try {
      const result = await api.games.enrich(gameId);
      const first = result.candidates[0];
      if (result.status === 'matched' && first !== undefined) {
        setCandidate(first);
        setPhase('matched');
        setOutcome(t('outcome.found'));
        return;
      }
      setPhase('idle');
      setOutcome(
        result.reason !== null && result.reason !== ''
          ? t('outcome.noMatchReason', { title, reason: result.reason })
          : t('outcome.noMatch', { title }),
      );
    } catch (caught) {
      setPhase('idle');
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setError(
        isApiError(caught) && caught.status !== 0
          ? caught.userMessage
          : t('error.generic'),
      );
    }
  }

  async function handleApply(selected: EnrichCandidate): Promise<void> {
    setPhase('applying');
    setError(null);
    try {
      const result = await api.games.enrich(gameId, {
        candidate: {
          source: selected.source,
          externalId: selected.externalId,
        },
      });
      setCandidate(null);
      setPhase('done');
      if (result.status !== 'matched') {
        setOutcome(t('outcome.noMatchApply'));
      } else if (result.applied) {
        setOutcome(t('outcome.applied'));
      } else {
        setOutcome(t('outcome.upToDate'));
      }
      router.refresh();
    } catch (caught) {
      setPhase('idle');
      if (isApiError(caught) && caught.status === 409) {
        setCandidate(null);
        setOutcome(null);
        setError(t('error.stale'));
        return;
      }
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setError(
        isApiError(caught) && caught.status !== 0
          ? caught.userMessage
          : t('error.unavailable'),
      );
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => {
          void handleSearch();
        }}
        disabled={busy}
        className="inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60"
      >
        {phase === 'searching'
          ? t('searching')
          : phase === 'applying'
            ? t('applying')
            : t('search')}
      </button>
      <p className="text-xs text-muted">{t('usesTitle', { title })}</p>

      {outcome !== null && (
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {outcome}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {candidate !== null && (
        <div className="w-full rounded-card border border-edge bg-surface p-4">
          <div className="flex flex-wrap gap-4">
            {cover !== null && (
              // eslint-disable-next-line @next/next/no-img-element -- API-served same-origin signed preview; next/image would add a /_next/image hop behind SessionGuard
              <img
                src={cover}
                alt={tDetail('coverAlt', { title: candidate.title })}
                className="aspect-[3/4] w-20 shrink-0 rounded-control border border-edge object-cover"
              />
            )}
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-ink">{candidate.title}</p>
              {candidateMetaParts.length > 0 && (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  {candidateMetaParts.map((part, index) => (
                    <Fragment key={`${String(index)}-${part}`}>
                      {index > 0 && (
                        <span aria-hidden className="h-3 w-px bg-edge" />
                      )}
                      <span>{part}</span>
                    </Fragment>
                  ))}
                </p>
              )}
              <p className="text-xs text-muted">
                {candidate.platforms
                  .map((platform) => platform.name)
                  .join(', ')}
              </p>
              <p className="text-xs text-muted">
                {t('source', { source: candidate.source })}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void handleApply(candidate);
              }}
              disabled={busy}
              className="inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60"
            >
              {t('apply')}
            </button>
            <button
              type="button"
              onClick={() => {
                setCandidate(null);
                setPhase('idle');
                setOutcome(null);
              }}
              disabled={busy}
              className="inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
