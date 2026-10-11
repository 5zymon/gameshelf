/**
 * `78/100` for a 0–100 rating (rounded); `null` when there is no rating.
 * `0` → `0/100`; out-of-range values are clamped to `[0, 100]`.
 */
export function formatRating(rating: number | null | undefined): string | null {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) return null;
  const value = Math.min(100, Math.max(0, Math.round(rating)));
  return `${String(value)}/100`;
}
