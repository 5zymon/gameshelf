import type { EnrichCandidate } from './api';

/** Stable identity of a candidate across a search/apply round-trip. */
export function candidateKey(candidate: EnrichCandidate): string {
  return `${candidate.source}:${String(candidate.externalId)}`;
}

/** Default selection: the top-ranked candidate, or null for an empty list. */
export function initialSelection(candidates: EnrichCandidate[]): string | null {
  const first = candidates[0];
  return first === undefined ? null : candidateKey(first);
}

/** Resolve the selected candidate by its key, or undefined. */
export function findSelectedCandidate(
  candidates: EnrichCandidate[],
  selectedKey: string | null,
): EnrichCandidate | undefined {
  return candidates.find(
    (candidate) => candidateKey(candidate) === selectedKey,
  );
}
