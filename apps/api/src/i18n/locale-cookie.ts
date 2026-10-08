import type { Response } from 'express';

/**
 * The `NEXT_LOCALE` cookie is the bridge between the API (which owns the
 * per-user language) and the Next.js web app (which reads it in
 * `getRequestConfig` to pick the message catalog).
 *
 * It is `httpOnly` on purpose: only the web app's server components read it
 * (via `cookies()`), and the client-side language switcher gets its value from
 * server props — JavaScript never needs to read the cookie, so it cannot leak.
 */
export const LOCALE_COOKIE_NAME = 'NEXT_LOCALE';

/** One year: the locale is a durable preference, not a per-session signal. */
export const LOCALE_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export function setLocaleCookie(
  res: Response,
  locale: string,
  cookieSecure: boolean,
): void {
  res.cookie(LOCALE_COOKIE_NAME, locale, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure,
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE_MS,
  });
}

/**
 * Clears the locale cookie. Called on explicit logout and on passive session
 * expiry (SessionGuard): the locale is a per-user preference, so a stale
 * cookie on a shared device would otherwise render the login screen in the
 * previous user's language. With the cookie gone the web app falls back to
 * the `pl` default.
 */
export function clearLocaleCookie(res: Response, cookieSecure: boolean): void {
  res.clearCookie(LOCALE_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure,
    path: '/',
  });
}
