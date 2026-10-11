import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy } from './lib/csp';

const SESSION_COOKIE_NAME = 'gameshelf_session';

/** Paths that render without a session and must never be redirected. */
const PUBLIC_PATHS = new Set(['/login', '/setup']);

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
