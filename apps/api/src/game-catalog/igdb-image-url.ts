/**
 * Rewrites an IGDB image URL to a specific size. Handles protocol-relative
 * URLs, replaces an existing `t_*` size segment, and inserts `size` when the
 * URL has no size segment. A non-IGDB-transform URL is returned unchanged
 * (best-effort; never throws).
 */
export function igdbImageUrl(
  url: string | null | undefined,
  size: string,
): string | null {
  if (url === null || url === undefined || url.trim() === '') return null;
  const absolute = url.startsWith('//') ? `https:${url}` : url;
  const marker = '/upload/';
  const at = absolute.indexOf(marker);
  if (at === -1) return absolute;
  const prefix = absolute.slice(0, at + marker.length);
  const remainder = absolute.slice(at + marker.length);
  if (remainder === '') return absolute; // nothing after /upload/ — leave as-is
  const slash = remainder.indexOf('/');
  const first = slash === -1 ? remainder : remainder.slice(0, slash);
  const rest = slash === -1 ? '' : remainder.slice(slash + 1);
  const hasSize = /^t_[a-z0-9_]+$/i.test(first);
  const tail = hasSize ? rest : remainder;
  return `${prefix}${size}/${tail}`;
}
