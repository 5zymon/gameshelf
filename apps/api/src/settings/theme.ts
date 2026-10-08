/**
 * Supported UI themes (ticket 7.3). 'system' is a real option — it tracks the
 * OS preference client-side; the server only stores and relays the choice.
 * The set is closed and shared by the validation rule, the wire contract, and
 * the `NEXT_THEME` cookie, so a typo can never reach the database or the
 * browser (mirrors `i18n/language.ts`).
 */
export const SUPPORTED_THEMES = ['light', 'dark', 'system'] as const;

export type Theme = (typeof SUPPORTED_THEMES)[number];

export const DEFAULT_THEME: Theme = 'system';

export function isTheme(value: unknown): value is Theme {
  return (
    typeof value === 'string' &&
    (SUPPORTED_THEMES as readonly string[]).includes(value)
  );
}

/**
 * Coerce a stored `users.theme` value into the closed `Theme` union (mirrors
 * `toLanguage`): a corrupt/legacy row falls back to the default rather than
 * surfacing a 500 or an invalid cookie value.
 */
export function toTheme(value: string): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}
