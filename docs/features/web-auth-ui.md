---
type: Feature
title: Web Auth UI
description: Browser login and first-run setup flows, the authenticated navigation shell, layered route protection, the same-origin /api proxy, and the cookie-only auth guarantee.
tags: [web, auth, ui]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-08T22:16:06Z }
---

# Overview

The Web Auth UI is the Next.js (`apps/web`) client wiring for the auth surfaces
exposed by the [Auth API](/auth-api.md) and [First-run Setup](/first-run-setup.md).
It adds three things the API alone cannot provide in a browser:

- a first-run **setup** form that creates the very first account;
- a **login** form and a **logout** control;
- **route protection** so the catalog shell is unreachable without a session.

It deliberately contains **no signup/register page or link** — self-registration
is disabled server-side (see [Auth API](/auth-api.md#out-of-scope)).

# Routes and protection

| Route            | Group    | Protection                                                                                       |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `/setup`         | `(auth)` | Server component: `getSetupStatus()`; redirects to `/login` when setup is already complete       |
| `/login`         | `(auth)` | Server component: `getSetupStatus()`; redirects to `/setup` while setup is required              |
| `/`              | `(app)`  | `middleware.ts` cookie check + `(app)/layout.tsx` `requireUser()`; `null` → `redirect('/login')` |
| `/platforms`     | `(app)`  | Same shell + `requireUser` guard                                                                 |
| `/import`        | `(app)`  | Same shell + `requireUser` guard                                                                 |
| `/settings`      | `(app)`  | Same shell + `requireUser` guard                                                                 |
| any `(app)` page | `(app)`  | Same layout guard — a new page under `(app)` is protected automatically                          |

Protection is layered and enforced **server-side**, not in client JavaScript:

- `middleware.ts` runs on every request, including the RSC requests Next.js
  makes for client-side (`<Link>`) navigations, where shared layouts are **not**
  re-rendered. It optimistically redirects to `/login` when the
  `gameshelf_session` cookie is absent, before any protected markup is produced.
  It performs no API or database call, so it is safe on prefetches.
- `lib/auth.ts#requireUser()` is the authoritative check. It calls
  `getCurrentUser()` and `redirect('/login')` on `null`, so a request with an
  expired-but-present cookie is still rejected. Both the `(app)` layout and each
  protected page call it, which is what makes an expired session redirect even
  on a soft navigation where the layout is reused.
- `(auth)/setup/page.tsx` and `(auth)/login/page.tsx` are
  `export const dynamic = 'force-dynamic'` so the redirect decision is made on
  every request rather than baked into a static page.

Unauthenticated `GET /` (and every other `(app)` route) returns a `307` to
`/login`; when setup is required, `GET /login` returns a `307` to `/setup`.

# Navigation shell (ticket 2.6)

`(app)/layout.tsx` is a server component that wraps every catalog route with the
same chrome: the **GameShelf** brand link, `components/main-nav.tsx`, the
**Add game** CTA, a sign-out button (`components/logout-button.tsx`), and a
30 px initials avatar (initials derived from the account email; the email itself
is exposed via the `nav.account` aria-label). `requireUser()` resolves the email
before render, so the initial HTML already contains the initials — there is no
client-side round-trip and therefore no flash of an empty or signed-out shell.
`LogoutButton` does not fetch on mount.

`components/main-nav.tsx` is a small client component (it needs `usePathname`
for active state) rendering four links:

| Label     | `href`       |
| --------- | ------------ |
| Catalog   | `/`          |
| Platforms | `/platforms` |
| Import    | `/import`    |
| Settings  | `/settings`  |

The active link gets `aria-current="page"` and a `bg-accent-soft text-accent-text`
rounded-full pill style;
`/` matches exactly while the others also match their sub-paths, so `/platforms`
does not light up for a hypothetical `/platforms-x`.

`getCurrentUser()` in `lib/api.ts` is wrapped in React `cache()`, so when the
layout and the page both call `requireUser()` during one navigation the API is
hit at most once. On a soft navigation only the page segment runs (the layout is
reused), so the cost stays at one `/auth/me` call.

# Same-origin `/api` rewrite

The browser never talks to the API origin directly. `apps/web/next.config.mjs`
rewrites every `/api/:path*` request to the API:

```js
async rewrites() {
  return [{ source: '/api/:path*', destination: `${apiOrigin}/:path*` }];
}
```

`apiOrigin` is `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`) with any
trailing slashes stripped. The client forms therefore `fetch('/api/auth/login')`
and friends with a **relative** URL and `credentials: 'same-origin'`.

Consequences:

- The `gameshelf_session` cookie is set on the **web origin** (e.g.
  `localhost:3000`), because the browser only ever sees that origin. No cross-
  origin cookie/CORS configuration is needed and `SameSite=Lax` keeps working.
- Server-side rendering forwards the incoming cookie explicitly. `lib/api.ts`
  `authFetch()` reads `cookies()` from `next/headers`, sets a `cookie` request
  header, and calls the API origin directly — so `getCurrentUser()` and
  `getGames()` see the same session the browser has.

The strict `'self'`-only Content Security Policy, the build-time self-hosted
fonts, and the zero-external-request guarantee that complete this single-origin
setup are documented in
[Single-Origin Frontend & API with Strict CSP](/single-origin-frontend-api.md).

# Cookie-only guarantee (no token storage)

Authentication is **cookie-only**. The session token lives in the
`gameshelf_session` cookie, which is `httpOnly` and `SameSite=Lax` (see
[Auth API](/auth-api.md#session-cookie)), so JavaScript cannot read it. The web
client never writes a token to `localStorage` or `sessionStorage`, and there is
no client-side token to leak: after login the browser is redirected and the
session is resolved on the server from the cookie.

Alongside the session cookie, the API manages a second `httpOnly` cookie,
`NEXT_LOCALE`, which carries the user's UI language to the web app: it is set
on login and first-run setup (healing a stale or missing value from the
stored preference) and cleared on logout and passive session expiry, so a
shared device never renders the login screen in the previous user's language.
The web app reads it in `getRequestConfig` and falls back to the English
default — see [Internationalization (EN default, PL)](/i18n.md).

A repository check confirms the absence:

```bash
grep -rnE 'localStorage|sessionStorage' apps/web/src   # no matches
```

# Error handling

Both forms use `noValidate`, so the browser sends the payload as-is and the API
owns validation. The client maps the response status to a message:

| Status                      | Login message                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `401`                       | `Incorrect email or password.` (identical for unknown email and wrong password — non-leaking) |
| `400`                       | `Enter an email and a password, then try again.` (validation failure)                         |
| other / 5xx / network error | `We couldn't sign you in right now. Check your connection and try again.`                     |

The setup form uses the same shape: `201` → `/login?setup=complete`, `409` →
`/login`, `400` → the same input-validation message, otherwise the generic
fallback. A `400` is never reported as a connection problem.

# Manual acceptance script

The frontend has no test runner in this ticket, so acceptance is manual. Run the
dev servers from the repository root:

```bash
npm install
cp .env.example .env     # fill in values (SESSION_SECRET ≥ 32 chars, DB, …)
docker compose up -d mysql
npm run db:deploy
npm run dev              # API on :3001, web on :3000
```

**Fresh install** requires an empty `users` table. On an existing dev database
reset it first (deleting every user row re-enables setup — see
[First-run Setup](/first-run-setup.md#one-shot-guarantee)):

```bash
docker compose down && rm -rf data/mysql
docker compose up -d mysql && npm run db:deploy
```

Then walk the seven acceptance criteria:

1. **Fresh install routes to setup and the first account is creatable.** Open
   `http://localhost:3000/`. Expect a `307` to `/setup` and the "First-run
   setup" card. Enter an email and password, click **Create account**. Expect a
   redirect to `/login?setup=complete` with the "Setup complete." banner.
2. **`/setup` redirects to `/login` after setup.** Open
   `http://localhost:3000/setup` (or reload the earlier URL). Expect a `307` to
   `/login`; there is no way back into the setup form.
3. **Wrong password shows the clear non-leaking error.** On `/login`, submit a
   wrong password for the created account. Expect `Incorrect email or password.`
   Submit an unknown email — the **same** message (no user enumeration).
   Submitting the empty form shows `Enter an email and a password, then try
again.` (not the connection message), because the API replies `400`.
4. **Login lands on the catalog; the shell navigates and guards every route.**
   Sign in with the correct credentials. Expect the catalog page at `/` with the
   account's initials avatar in the header (the email is exposed via the avatar's
   `aria-label`) and the **Catalog / Platforms / Import / Settings** nav. Click
   each nav item: expect the matching page (with the same shell) and the active
   link carrying `aria-current="page"`. Click **Sign out**; expect `/login`. Open
   `/`, `/platforms`, `/import` and `/settings` again; expect a `307` back to
   `/login` each time.
5. **No signup link anywhere.** Inspect `/login` and `/setup` (and the catalog
   header). There is no "Sign up", "Register" or "Create account" link. The only
   `Create account` text is the setup form's submit button, which is reachable
   only before setup.
6. **No token in `localStorage`/`sessionStorage`.** On any page open DevTools →
   Application → Local Storage and Session Storage: both empty. In the console,
   `localStorage.length === 0 && sessionStorage.length === 0` returns `true`.
   Under Cookies, `gameshelf_session` is present with `HttpOnly` and
   `SameSite=Lax`; `document.cookie` does not contain it.
7. **An expired session mid-use routes back to `/login`.** While signed in on
   `/`, delete the `gameshelf_session` cookie in DevTools (or revoke the session
   server-side), then click a nav link. Expect to land on `/login`: the page
   segment is re-fetched, `requireUser()` sees the missing/expired session and
   redirects. The missing cookie alone is already caught by `middleware.ts` on
   the next navigation.

## Proxy smoke commands

These exercise the same-origin `/api` rewrite (web origin `:3000`, API `:3001`)
and were run against the dev servers while verifying this feature. All responses
below were observed on 2026-10-06 with setup already completed.

```bash
# Public setup status through the proxy
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/setup/status   # 200

# No session → 401
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/auth/me         # 401
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/games           # 401

# Empty credentials → 400 (form shows the input-validation message)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' -d '{"email":"","password":""}'               # 400

# Wrong credentials → 401 (non-leaking message)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' -d '{"email":"nobody@example.com","password":"wrong"}'  # 401

# Self-registration is absent → 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/auth/register \
  -H 'content-type: application/json' -d '{"email":"a@b.c","password":"x"}'         # 404

# Server-side route protection (no cookie): every catalog route -> 307 /login
for p in / /platforms /import /settings; do
  curl -s -o /dev/null -w "$p -> %{http_code} %{redirect_url}\n" "http://localhost:3000$p"
done
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://localhost:3000/setup      # 307 -> /login (setup complete)

# The matcher excludes /api, so the proxy still answers without a cookie
curl -s -o /dev/null -w 'api/setup/status -> %{http_code}\n' http://localhost:3000/api/setup/status   # 200
```

# Out of scope

- Automated frontend tests (Vitest/Playwright); this ticket uses the manual
  script above instead.
- Pagination UI — the catalog requests `limit=24` and renders that page only.
- Any change to the rewrite/env design or the SSR cookie-forwarding behavior.
  (The Content Security Policy, font self-hosting, and the zero-external-request
  guarantee are owned by
  [Single-Origin Frontend & API with Strict CSP](/single-origin-frontend-api.md),
  which supersedes this exclusion for those concerns.)
