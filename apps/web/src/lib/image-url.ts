/**
 * Same-origin only: a root-relative path, never an external URL. CSP sets
 * img-src 'self'. Backslashes are rejected because browsers normalise `\` to
 * `/`, so `/\evil.com` would otherwise become protocol-relative (`//evil.com`).
 */
export function sameOriginPath(url: string | null | undefined): string | null {
  return url !== null &&
    url !== undefined &&
    url.startsWith('/') &&
    !url.startsWith('//') &&
    !url.includes('\\')
    ? url
    : null;
}
