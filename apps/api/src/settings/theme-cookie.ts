import type { Response } from 'express';

/**
 * The `NEXT_THEME` cookie is the bridge between the API (which owns the
 * per-user theme) and the Next.js web app (which reads it in the root layout
 * to pick the theme for the first paint). Same contract as `NEXT_LOCALE`:
 * httpOnly (only server components read it), one-year maxAge, cleared on
 * logout and passive session expiry so a shared device falls back to the
 * system default.
 */
export const THEME_COOKIE_NAME = 'NEXT_THEME';

/** One year: the theme is a durable preference, not a per-session signal. */
export const THEME_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export function setThemeCookie(
  res: Response,
  theme: string,
  cookieSecure: boolean,
): void {
  res.cookie(THEME_COOKIE_NAME, theme, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure,
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE_MS,
  });
}

/**
 * Clears the theme cookie. Called on explicit logout and on passive session
 * expiry (SessionGuard): with the cookie gone the web app falls back to the
 * `system` default, so a shared device never keeps the previous user's theme.
 */
export function clearThemeCookie(res: Response, cookieSecure: boolean): void {
  res.clearCookie(THEME_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure,
    path: '/',
  });
}
