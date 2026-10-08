'use client';

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
            : `${String(candidate.playerCount)} players`,
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
        setOutcome('Found a match.');
        return;
      }
      setPhase('idle');
      setOutcome(
        result.reason !== null && result.reason !== ''
          ? `No match found for “${title}”. ${result.reason} Nothing changed.`
          : `No match found for “${title}”. Nothing changed.`,
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
          : "We couldn't reach the game database. Try again.",
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
        setOutcome('No match found. Nothing changed.');
      } else if (result.applied) {
        setOutcome('Fresh metadata applied.');
      } else {
        setOutcome('Already up to date — nothing changed.');
      }
      router.refresh();
    } catch (caught) {
      setPhase('idle');
      if (isApiError(caught) && caught.status === 409) {
        setCandidate(null);
        setOutcome(null);
        setError('That match is no longer available. Run the search again.');
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
          : "We couldn't apply the match. Try again.",
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
        className="rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
      >
        {phase === 'searching'
          ? 'Searching…'
          : phase === 'applying'
            ? 'Applying…'
            : 'Re-enrich from title'}
      </button>
      <p className="text-xs text-muted">Uses the current title “{title}”.</p>

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
        <div className="w-full rounded-xl border border-edge bg-shelf/40 p-4">
          <div className="flex flex-wrap gap-4">
            {cover !== null && (
              // eslint-disable-next-line @next/next/no-img-element -- API-served same-origin signed preview; next/image would add a /_next/image hop behind SessionGuard
              <img
                src={cover}
                alt={`${candidate.title} cover art`}
                className="aspect-[3/4] w-20 shrink-0 rounded-md border border-edge object-cover"
              />
            )}
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-fog">{candidate.title}</p>
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
              <p className="text-xs text-muted">Source: {candidate.source}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void handleApply(candidate);
              }}
              disabled={busy}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60"
            >
              Apply metadata
            </button>
            <button
              type="button"
              onClick={() => {
                setCandidate(null);
                setPhase('idle');
                setOutcome(null);
              }}
              disabled={busy}
              className="rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
