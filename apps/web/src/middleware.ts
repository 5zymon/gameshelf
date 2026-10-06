import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE_NAME = 'gameshelf_session';

/**
 * Optimistic route protection for the catalog shell.
 *
 * Middleware runs on every navigation, including client-side RSC requests,
 * where shared layouts are NOT re-rendered. It therefore only checks that the
 * httpOnly session cookie is present; the authoritative server-side session
 * validation happens in `lib/auth.ts#requireUser`, close to the route that
 * renders (Next.js authentication guidance). A missing cookie is enough to
 * redirect before any protected markup is produced.
 */
export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Protect every route except the auth screens, the same-origin API proxy,
  // and Next.js internals / favicon.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|login|setup).*)'],
};
