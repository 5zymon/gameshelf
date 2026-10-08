import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import type { AbstractIntlMessages } from 'next-intl';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE_NAME } from './config';

/**
 * Per-request i18n configuration (no i18n routing). The locale comes from the
 * `NEXT_LOCALE` cookie the API writes on login/setup/preferences-PUT; anything
 * missing or invalid falls back to the Polish default. Reading the cookie makes
 * the app request-dynamic, which is fine: every route is already
 * `force-dynamic`.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieValue = store.get(LOCALE_COOKIE_NAME)?.value;
  const locale = isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;

  // Dynamic import so the unused locale's catalog is never bundled into the
  // other locale's build output. The dynamic path makes the module `any`, so
  // cast it to the catalog shape before reading `.default`.
  const catalog = (await import(`../../messages/${locale}.json`)) as {
    default: AbstractIntlMessages;
  };
  const messages = catalog.default;

  return {
    locale,
    timeZone: 'UTC',
    messages,
  };
});
