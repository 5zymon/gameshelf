---
type: Feature
title: Single-Origin Frontend & API with Strict CSP
description: The Next.js frontend and the NestJS API share one origin via a server-side /api rewrite with a first-party session cookie, a nonce-based 'self'-only Content Security Policy, and build-time self-hosted fonts.
tags: [web, security, csp, fonts]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-06T17:00:00Z }
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
2. a strict Content Security Policy that only ever allows `'self'`;
3. fonts self-hosted at build time, so today's UI (which renders no covers yet)
   loads zero external resources.

# Content Security Policy

`apps/web/src/middleware.ts` builds a fresh Content Security Policy per request
and sets it on **both** the request (so Next.js can read the nonce and stamp it
onto its inline scripts) and the response (so the browser enforces it). The
middleware matcher covers every document route but excludes `/api`,
`/_next/static`, `/_next/image`, and `/favicon.ico`; the auth screens
(`/login`, `/setup`) are matched so they receive a nonce too, and are allowed to
render without a session.

| Directive         | Value                                     | Notes                                                        |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `default-src`     | `'self'`                                  | Fallback for every unlisted type                             |
| `script-src`      | `'self' 'nonce-<nonce>' 'strict-dynamic'` | `'unsafe-eval'` is dev-only                                  |
| `style-src`       | `'self' 'nonce-<nonce>'`                  | No `'unsafe-inline'` anywhere                                |
| `img-src`         | `'self'`                                  | Covers/images must be same-origin; external URLs are blocked |
| `font-src`        | `'self'`                                  | Fonts are served from `/_next/static/media`                  |
| `connect-src`     | `'self'`                                  | `fetch`/XHR only to the app origin                           |
| `object-src`      | `'none'`                                  | No plugins                                                   |
| `base-uri`        | `'self'`                                  | No injected `<base>`                                         |
| `form-action`     | `'self'`                                  | Forms post to the app origin only                            |
| `frame-ancestors` | `'none'`                                  | Clickjacking protection                                      |

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
- **No external host.** Every directive is `'self'` (plus the nonce and
  `'strict-dynamic'`); there is no `http://`, `https://`, or `*` source.
- **Covers must be same-origin.** The API's `coverUrl` still points at the
  external source (IGDB returns `https://images.igdb.com/...`; see
  `GameDetailModel.coverUrl`), but no page renders a cover yet, so
  `img-src 'self'` is not exercised today. Any cover the UI adds must be served
  same-origin — through `next/image` optimization or a first-party API image
  route — because `img-src 'self'` deliberately does **not** permit direct
  external image URLs.

Production static pages would be rendered at build time without a nonce, so all
document routes are dynamically rendered (`export const dynamic =
'force-dynamic'`). `app/not-found.tsx` exists specifically so the implicit
`/_not-found` route is dynamic too and its scripts are nonced.

# Self-hosted fonts

The root layout loads Geist through `next/font/google`:

```ts
import { Geist } from 'next/font/google';

const geistSans = Geist({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-sans',
});
```

`next/font` downloads the font files **at build time** and emits them under
`/_next/static/media/*.woff2`, served by the app itself. At runtime the browser
requests the font from the app origin only — there is no request to a font CDN
(`fonts.googleapis.com`, `fonts.gstatic.com`). `globals.css` consumes the
generated CSS variable:

```css
body {
  font-family: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
}
```

Because the font is first-party, `font-src 'self'` is sufficient and no font host
appears in the CSP.

> **Offline / air-gapped builds.** `next/font/google` downloads Geist from Google
> at **build time**, so `next build` needs network access to `fonts.googleapis.com`
> / `fonts.gstatic.com`; an offline build fails. The alternative is
> `next/font/local` with the OFL-licensed Geist `.woff2` file (and its license)
> committed to the repo. Either way the runtime result is identical: the font is
> self-hosted and `font-src 'self'` is sufficient.

# Zero external requests

The **current UI** makes no request to a non-GameShelf origin on a page load: it
renders no covers and self-hosts its fonts. Verify it two ways:

- **Network panel.** Open DevTools → Network, hard-reload `/login` (or any page),
  and confirm every request's host is the app origin. There is no
  `fonts.googleapis.com`, `fonts.gstatic.com`, CDN, or analytics host.
- **Grep the served HTML.** Inline `src`/`href` attributes must never point at an
  absolute external URL:

  ```bash
  curl -sS http://localhost:3000/login | grep -oE '(src|href)="https?://[^"]+"' || echo 'OK: none'
  ```

  And the built CSS/JS must not reference a font CDN:

  ```bash
  grep -rIl 'fonts.gstatic\|fonts.googleapis' apps/web/.next/static || echo OK
  ```

> **Covers (future work).** The API exposes external `coverUrl` values (IGDB's
> `https://images.igdb.com/...`; see `GameDetailModel.coverUrl`), but no page
> renders them yet. `img-src 'self'` deliberately allows no external image host,
> so any future cover rendering must go through a same-origin path — `next/image`
> optimization or a same-origin API image route — or the browser will CSP-block
> it. Until covers ship, the zero-external-request guarantee holds for the
> current UI only.

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

- Automated frontend tests for the CSP/font behavior; verification is the manual
  Network-panel and curl checks above.
- CDN or multi-origin deployment topologies.
- CSRF tokens (the app relies on `SameSite=Lax`; see [Auth API](/auth-api.md)).
