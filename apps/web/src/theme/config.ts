/**
 * Theme configuration for the web app (ticket 7.3). Mirrors `i18n/config.ts`:
 * the set is closed and mirrors the API's `SUPPORTED_THEMES`; the value is
 * carried in the `NEXT_THEME` cookie (written by the API on
 * login/setup/preferences-PUT and cleared on logout). 'system' is a real
 * option — it is resolved client-side against the OS preference.
 */
export const THEMES = ['light', 'dark', 'system'] as const;

export type AppTheme = (typeof THEMES)[number];

export const DEFAULT_THEME: AppTheme = 'system';

/** The cookie the API writes; read in the root layout. */
export const THEME_COOKIE_NAME = 'NEXT_THEME';

export function isTheme(value: unknown): value is AppTheme {
  return (
    typeof value === 'string' && (THEMES as readonly string[]).includes(value)
  );
}
