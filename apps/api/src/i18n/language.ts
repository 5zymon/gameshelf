/**
 * Supported UI languages (ticket 7.2). English is the default; the set is
 * closed and shared by the validation rule, the wire contract, and the
 * `NEXT_LOCALE` cookie, so a typo can never reach the database or the browser.
 */
export const SUPPORTED_LANGUAGES = ['pl', 'en'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

export function isLanguage(value: unknown): value is Language {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Coerce a stored `users.language` value into the closed `Language` union.
 * Prisma types the column as `string`; the value is constrained to the
 * supported set by the DB default and the `PUT` validation, so this only
 * guards against a corrupt/legacy row (which we fall back to the default for
 * rather than surfacing a 500). Shared by every path that reads a stored
 * row — preferences, login, and `me` — so an invalid value can never reach
 * the `NEXT_LOCALE` cookie or a response body.
 */
export function toLanguage(value: string): Language {
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}
