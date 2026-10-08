import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { ThemeProvider } from '@/components/theme-provider';
import { DEFAULT_THEME, isTheme, THEME_COOKIE_NAME } from '@/theme/config';
import './globals.css';

// `latin-ext` covers the Polish diacritics (ą, ć, ę, ł, ń, ó, ś, ź, ż); without
// it the browser would fall back to a non-Geist font for accented characters.
const geistSans = Geist({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-geist-sans',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  return {
    title: t('title'),
    description: t('description'),
  };
}

/**
 * First-paint theme (ticket 7.3). The stored preference comes from the
 * `NEXT_THEME` cookie the API writes (missing/invalid → the `system` default,
 * which the script resolves against the OS preference).
 *
 * The script is a raw, synchronous inline `<script>` in `<head>` — NOT
 * `next/script`. In the App Router, `next/script` with `beforeInteractive`
 * does not run before first paint: Next streams it as a queued payload
 * (`self.__next_s`) that only executes once the (async) runtime chunks load,
 * so a user whose effective theme is dark would see a light flash. A
 * synchronous inline `<head>` script runs during initial HTML parsing, before
 * first paint, in both dev and production.
 *
 * The preference value is inlined because the `NEXT_THEME` cookie is httpOnly
 * (JS cannot read it) and validated by `isTheme`, so it can never break out of
 * the string literal. The `nonce` is read from the `x-nonce` request header
 * set by `src/middleware.ts` — the same nonce as the CSP — so the script
 * passes the strict CSP. The `dark` class is never in the React tree: the
 * script and `ThemeProvider` own it on `document.documentElement`, so
 * hydration cannot strip it; `suppressHydrationWarning` on `<html>` keeps the
 * dev console quiet about the class the script applies before hydration.
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const locale = await getLocale();
  const messages = await getMessages();
  const store = await cookies();
  const cookieValue = store.get(THEME_COOKIE_NAME)?.value;
  const theme = isTheme(cookieValue) ? cookieValue : DEFAULT_THEME;
  const nonce = (await headers()).get('x-nonce') ?? '';

  // The script body is a string (not an executed expression): it is inlined
  // verbatim and the browser runs it during HTML parsing, before first paint.
  // `theme` is validated by `isTheme`, so the inlined value can never break
  // out of the string literal.
  const themeInitScript = `(function () {
    var theme = ${JSON.stringify(theme)};
    var dark;
    if (theme === 'dark') {
      dark = true;
    } else if (theme === 'light') {
      dark = false;
    } else {
      dark = !!(
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
      );
    }
    document.documentElement.classList.toggle('dark', dark);
  })();`;

  return (
    <html lang={locale} className={geistSans.variable} suppressHydrationWarning>
      <head>
        {/*
          `suppressHydrationWarning`: the nonce is per-request (random) and read
          from the `x-nonce` request header via `headers()`. On the server that
          yields the real nonce; on the client's hydration render `headers()` is
          empty, so React's virtual render produces `nonce=""` and would log a
          mismatch against the server's real nonce. The script is safe anyway:
          it runs synchronously during initial HTML parse (before hydration)
          with the real nonce, so it passes the CSP. React later empties the
          nonce attribute on hydration, but the script has already executed, so
          that has no effect. `suppressHydrationWarning` only silences the
          dev-only mismatch warning.
        */}
        <script
          id="gameshelf-theme-init"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      {/*
        `suppressHydrationWarning` on `<body>`: browser extensions mutate the
        body before hydration — e.g. ColorZilla adds `cz-shortcut-listen="true"`
        — which React would otherwise flag as an attribute mismatch on every
        page. The app never sets that attribute; this only silences the dev-only
        warning for `<body>` attribute drift injected by an extension.
      */}
      <body
        className="min-h-dvh bg-ink text-fog antialiased"
        suppressHydrationWarning
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider theme={theme}>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
