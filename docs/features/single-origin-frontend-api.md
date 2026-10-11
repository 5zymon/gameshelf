---
type: Feature
title: Single-Origin Frontend & API with Strict CSP
description: The Next.js frontend and the NestJS API share one origin via a server-side /api rewrite with a first-party session cookie, a nonce-based 'self'-only Content Security Policy, and build-time self-hosted fonts.
tags: [web, security, csp, fonts]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-08T21:54:58Z }
---

# Overview

GameShelf serves the browser from a single origin. The [web app](/web-auth-ui.md)
is the only host the browser talks to; every API call goes to a same-origin
`/api/:path*` URL that Next.js rewrites server-side to the NestJS API. Because
the browser never contacts the API host directly, the `gameshelf_session` cookie
issued by the [Auth API](/auth-api.md) is a plain host-only first-party cookie on
the app's own origin — no cross-origin CORS, no cookie `Domain`, no external
reverse proxy, and no assumption that TLS terminates anywhere else.

This document covers the three guarantees that make that setup work end to end:

1. the same-origin `/api` rewrite (server-to-server);
2. a strict Content Security Policy that allows `'self'` everywhere except the
   single, scoped YouTube-embed exception for the game-detail video player;
3. self-hosted assets at build time (fonts) and a local cover cache served
   from the app origin, so the UI loads zero external resources at runtime.

# Content Security Policy

`apps/web/src/lib/csp.ts` builds a fresh Content Security Policy
(`contentSecurityPolicy`) per request and `apps/web/src/middleware.ts` sets it on
**both** the request (so Next.js can read the nonce and stamp it onto its inline
scripts) and the response (so the browser enforces it). The
middleware matcher covers every document route but excludes `/api`,
`/_next/static`, `/_next/image`, and `/favicon.ico`; the auth screens
(`/login`, `/setup`) are matched so they receive a nonce too, and are allowed to
render without a session.

| Directive         | Value                                                                                        | Notes                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `default-src`     | `'self'`                                                                                     | Fallback for every unlisted type                                                      |
| `script-src`      | `'self' 'nonce-<nonce>' 'strict-dynamic' https://www.youtube.com https://player.youtube.com` | `'unsafe-eval'` is dev-only; the YouTube hosts are the card-9.1 exception (see below) |
| `style-src`       | `'self' 'nonce-<nonce>'`                                                                     | No `'unsafe-inline'` anywhere                                                         |
| `img-src`         | `'self' blob:`                                                                               | Covers same-origin; local `blob:` thumbnails for photo import                         |
| `font-src`        | `'self'`                                                                                     | Fonts are served from `/_next/static/media`                                           |
| `connect-src`     | `'self'`                                                                                     | `fetch`/XHR only to the app origin                                                    |
| `worker-src`      | `'self' blob:`                                                                               | The HEIC→JPEG libheif worker is spawned from a `blob:` URL                            |
| `frame-src`       | `'self' https://www.youtube.com https://player.youtube.com`                                  | The game-detail YouTube player only (card 9.1)                                        |
| `object-src`      | `'none'`                                                                                     | No plugins                                                                            |
| `base-uri`        | `'self'`                                                                                     | No injected `<base>`                                                                  |
| `form-action`     | `'self'`                                                                                     | Forms post to the app origin only                                                     |
| `frame-ancestors` | `'none'`                                                                                     | Clickjacking protection                                                               |

Key properties:

- **Nonce via middleware.** A fresh base64 nonce is generated for every request
  (`crypto.randomUUID()`). Setting the CSP on the _request_ headers is what makes
  Next.js extract the nonce and attach it to each inline bootstrap/flight script;
  `'strict-dynamic'` then lets those nonced scripts load the `/_next/static`
  chunks. The same CSP string is set on the response so the browser enforces it.
- **`'unsafe-eval'` is dev-only.** React's development build uses `eval`;
  production omits it.
- **No `upgrade-insecure-requests`.** That directive would rewrite plain-HTTP
  subresource URLs to HTTPS and break the supported `http://localhost` install.
- **No external host, with one scoped exception.** Every directive is `'self'`
  (plus the nonce, `'strict-dynamic'`, and the local-only `blob:` used for
  photo-import thumbnails and the HEIC converter worker). The **only** external
  origins named anywhere are the YouTube embed hosts
  (`https://www.youtube.com`, `https://player.youtube.com`), added to
  `script-src` and `frame-src` for the game-detail video player (card 9.1). Under
  `'strict-dynamic'`, CSP3 browsers ignore the host entries in `script-src` — the
  player's scripts run inside the iframe's own document, which our policy does
  not govern — but the hosts are present because the card asks for them. Nothing
  is fetched from YouTube until the user presses play
  ([Game Summary, Rating & YouTube Videos](/game-summary-rating-videos.md)).
- **Covers are same-origin.** A saved `Game.coverUrl` is a first-party
  `/api/covers/<file>` path, not an external URL: the import downloads the
  external cover once into the local cache and the API serves it through
  `GET /covers/:file`, which the `/api` rewrite puts on the app origin (see
  [Game Metadata Enrichment](/game-metadata-enrichment.md)). `img-src 'self'`
  therefore permits it, while a direct external image URL would be blocked.

Production static pages would be rendered at build time without a nonce, so all
document routes are dynamically rendered (`export const dynamic =
'force-dynamic'`). `app/not-found.tsx` exists specifically so the implicit
`/_not-found` route is dynamic too and its scripts are nonced.

# Self-hosted fonts

The root layout loads two faces through `next/font/google`, both self-hosted
at build time: **Manrope** (body) and **Sora** (display/headings).

```ts
import { Manrope, Sora } from 'next/font/google';

// `latin-ext` covers the Polish diacritics (ą, ć, ę, ł, ń, ó, ś, ź, ż) for
// both faces; without it the browser falls back to another font for accents.
const manrope = Manrope({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-manrope',
});
const sora = Sora({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-sora',
});
```

`latin-ext` is required because the UI's default locale is Polish (see
[Internationalization (PL default, EN)](/i18n.md)): the base `latin` subset
does not contain the accented characters, and without the extra subset the
browser would fall back to a different font for every ą/ę/ł/ó/ś/ź/ż.

`next/font` downloads the font files **at build time** and emits them under
`/_next/static/media/*.woff2`, served by the app itself. At runtime the browser
requests the fonts from the app origin only — there is no request to a font
CDN. `globals.css` declares the font tokens in `@theme` from the generated CSS
variables and applies the body face:

```css
@theme {
  --font-sans:
    var(--font-manrope), ui-sans-serif, system-ui, -apple-system, 'Segoe UI',
    sans-serif;
  --font-display:
    var(--font-sora), var(--font-manrope), ui-sans-serif, system-ui,
    -apple-system, 'Segoe UI', sans-serif;
}

body {
  font-family: var(--font-sans);
}
```

`h1`–`h3` (and the wordmark) use `--font-display`. Because the fonts are
first-party, `font-src 'self'` is sufficient and no font host appears in the
CSP.

> **Offline / air-gapped builds.** `next/font/google` downloads **both faces**
> from the Google Fonts CDN at **build time**, so `next build` needs network
> access to it; an offline build fails. The alternative is `next/font/local`
> with the OFL-licensed `.woff2` files (and their licenses) committed to the
> repo. Either way the runtime result is identical: the fonts are self-hosted
> and `font-src 'self'` is sufficient.

# Zero external requests

The app makes no request to a non-GameShelf origin on a page load: it self-hosts
its fonts and any rendered cover is a same-origin `/api/covers/<file>` asset.
The one external connection the UI can make is the game-detail YouTube iframe,
and only **after** the user presses play — the initial HTML contains no
`<iframe>`, so a page load still touches nothing external. Verify it two ways:

- **Network panel.** Open DevTools → Network, hard-reload `/login` (or any page),
  and confirm every request's host is the app origin. There is no Google Fonts,
  image CDN, or analytics host.
- **Grep the served HTML.** Inline `src`/`href` attributes must never point at an
  absolute external URL:

  ```bash
  curl -sS http://localhost:3000/login | grep -oE '(src|href)="https?://[^"]+"' || echo 'OK: none'
  ```

  And the built CSS/JS must not reference a font CDN:

  ```bash
  grep -rIlE 'fonts\.(gstatic|googleapis)' apps/web/.next/static || echo OK
  ```

> **Covers.** A saved `Game.coverUrl` is a same-origin `/api/covers/<file>` path,
> never an external host: the import downloads the external cover into the local
> cache and the API serves it (see
> [Game Metadata Enrichment](/game-metadata-enrichment.md)). A direct external
> image URL would be blocked by `img-src 'self'`; the cache is what makes cover
> rendering CSP-safe without loosening the policy.

# Configuration and the "no proxy" guarantee

`NEXT_PUBLIC_API_URL` is the **internal** API origin used by the rewrite and by
SSR; the browser never sees it. It must point at the API directly and must not be
a reverse proxy or TLS terminator:

```js
async rewrites() {
  return [{ source: '/api/:path*', destination: `${apiOrigin}/:path*` }];
}
```

There is deliberately no `trust proxy` / `X-Forwarded-*` handling in the API,
no `proxy_set_header` in any config, and `SESSION_COOKIE_SECURE` defaults to
`false` (`false` is the supported plain-HTTP LAN default; operators on TLS set
it to `true`). No config assumes TLS terminates elsewhere.

# Out of scope

- Automated frontend tests for the font behavior; verification is the manual
  Network-panel and curl checks above. The CSP directive set is unit-tested
  (`apps/web/test/csp.test.mjs`).
- CDN or multi-origin deployment topologies.
- CSRF tokens (the app relies on `SameSite=Lax`; see [Auth API](/auth-api.md)).
