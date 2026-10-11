/**
 * YouTube embed hosts: the ONLY sanctioned external origins (card 9.1; a scoped
 * exception to ADR-004 / spec §7 "the browser loads nothing from an external
 * host"). Used for the game-detail Videos player only. Not a bug — see
 * docs/features/single-origin-frontend-api.md. If the player fails to load,
 * add 'https://www.youtube-nocookie.com' to the same two directives.
 */
export const YOUTUBE_EMBED_SOURCES = [
  'https://www.youtube.com',
  'https://player.youtube.com',
] as const;

/**
 * Strict, self-only policy. The per-request nonce lets Next.js execute its
 * inline bootstrap/flight scripts without `'unsafe-inline'`; `'strict-dynamic'`
 * lets those nonce'd scripts load the `/_next/static` chunks. `'unsafe-eval'`
 * is dev-only (React debugging); it is absent from production.
 *
 * Deliberately NO `upgrade-insecure-requests`: it would rewrite plain-HTTP
 * subresource URLs to HTTPS and break the supported `http://localhost` setup.
 */
export function contentSecurityPolicy(
  nonce: string,
  isDev = process.env.NODE_ENV === 'development',
): string {
  const youtubeSources = YOUTUBE_EMBED_SOURCES.join(' ');
  return [
    "default-src 'self'",
    // Under `'strict-dynamic'`, CSP3 browsers ignore the YouTube host entries
    // here; the player's scripts run in the iframe's own document, which our
    // CSP does not govern. The hosts are present because the card asks for them.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${youtubeSources}${
      isDev ? " 'unsafe-eval'" : ''
    }`,
    // `'unsafe-inline'` is dev-only: the Next.js Dev Tools overlay injects
    // inline <style> tags that style-src otherwise blocks. In dev the nonce is
    // dropped because `'unsafe-inline'` is ignored whenever a nonce is present.
    // Never in production.
    `style-src 'self'${isDev ? " 'unsafe-inline'" : ` 'nonce-${nonce}'`}`,
    // `blob:` is required by the photo import screen: thumbnails are local
    // `URL.createObjectURL` blobs and the HEIC→JPEG converter spawns a
    // blob worker.
    "img-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    // Only for the game-detail YouTube player (card 9.1).
    `frame-src 'self' ${youtubeSources}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
