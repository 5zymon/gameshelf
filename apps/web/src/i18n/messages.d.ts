import type pl from '../../messages/pl.json';

/**
 * Teaches next-intl the app's locale set and message shape so the translator
 * is fully typed: a key missing from `pl.json` is a compile error, and the
 * message-parity test (test/messages.test.mjs) catches a key missing from
 * `en.json`. `pl.json` is the source of truth for the key set.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: 'pl' | 'en';
    Messages: typeof pl;
  }
}
