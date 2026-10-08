import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE_NAME = 'gameshelf_session';

/** Paths that render without a session and must never be redirected. */
const PUBLIC_PATHS = new Set(['/login', '/setup']);

/**
 * Strict, self-only policy. The per-request nonce lets Next.js execute its
 * inline bootstrap/flight scripts without `'unsafe-inline'`; `'strict-dynamic'`
 * lets those nonce'd scripts load the `/_next/static` chunks. `'unsafe-eval'`
 * is dev-only (React debugging); it is absent from production.
 *
 * Deliberately NO `upgrade-insecure-requests`: it would rewrite plain-HTTP
 * subresource URLs to HTTPS and break the supported `http://localhost` setup.
 */
function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
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
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  // Expose the same nonce to the server components (root layout) so the
  // synchronous first-paint theme script can carry it and pass the CSP.
  // `next/script` and Next's own inline scripts still read it from the CSP
  // header above; this header is the clean value for a raw <script nonce>.
  requestHeaders.set('x-nonce', nonce);

  if (
    !PUBLIC_PATHS.has(request.nextUrl.pathname) &&
    !request.cookies.has(SESSION_COOKIE_NAME)
  ) {
    const redirect = NextResponse.redirect(new URL('/login', request.url));
    redirect.headers.set('Content-Security-Policy', csp);
    return redirect;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Same-origin API proxy and Next internals are excluded with exact segment
  // boundaries, so `/api` (and `/api/...`) and `/favicon.ico` bypass while
  // lookalikes such as `/apiary` and `/favicon.icoX` are still covered. Auth
  // screens are handled in the function (PUBLIC_PATHS) so they still receive
  // the CSP nonce.
  matcher: ['/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico$).*)'],
};
