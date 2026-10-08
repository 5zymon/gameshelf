/**
 * Locale configuration for the web app (ticket 7.2). Polish is the default.
 * The set is closed and mirrors the API's `SUPPORTED_LANGUAGES`; the value is
 * carried in the `NEXT_LOCALE` cookie (written by the API on
 * login/setup/preferences-PUT and cleared on logout).
 */
export const LOCALES = ['pl', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'pl';

/** The cookie the API writes; read here in `getRequestConfig`. */
export const LOCALE_COOKIE_NAME = 'NEXT_LOCALE';

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
  );
}
