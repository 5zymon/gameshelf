---
type: Feature
title: Web Auth UI
description: Browser login and first-run setup flows, route protection, the same-origin /api proxy, and the cookie-only auth guarantee.
tags: [web, auth, ui]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-06T00:00:00Z }
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

| Route            | Group    | Protection                                                                                 |
| ---------------- | -------- | ------------------------------------------------------------------------------------------ |
| `/setup`         | `(auth)` | Server component: `getSetupStatus()`; redirects to `/login` when setup is already complete |
| `/login`         | `(auth)` | Server component: `getSetupStatus()`; redirects to `/setup` while setup is required        |
| `/`              | `(app)`  | `(app)/layout.tsx` calls `getCurrentUser()`; `null` → `redirect('/login')`                 |
| any `(app)` page | `(app)`  | Same layout guard as `/` — a new page under `(app)` is protected automatically             |

Protection is enforced **server-side** in server components, not in client
JavaScript: `(app)/layout.tsx` resolves the session and redirects before it
renders any protected markup. `(auth)/setup/page.tsx` and `(auth)/login/page.tsx`
are `export const dynamic = 'force-dynamic'` so the redirect decision is made on
every request rather than baked into a static page.

Unauthenticated `GET /` returns a `307` to `/login`; when setup is required,
`GET /login` returns a `307` to `/setup`.

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

# Cookie-only guarantee (no token storage)

Authentication is **cookie-only**. The session token lives in the
`gameshelf_session` cookie, which is `httpOnly` and `SameSite=Lax` (see
[Auth API](/auth-api.md#session-cookie)), so JavaScript cannot read it. The web
client never writes a token to `localStorage` or `sessionStorage`, and there is
no client-side token to leak: after login the browser is redirected and the
session is resolved on the server from the cookie.

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

Then walk the six acceptance criteria:

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
4. **Login lands on the catalog; logout returns to login and `/` bounces back.**
   Sign in with the correct credentials. Expect the catalog page at `/` with the
   account email in the header. Click **Sign out**; expect `/login`. Open `/`
   again; expect a `307` back to `/login`.
5. **No signup link anywhere.** Inspect `/login` and `/setup` (and the catalog
   header). There is no "Sign up", "Register" or "Create account" link. The only
   `Create account` text is the setup form's submit button, which is reachable
   only before setup.
6. **No token in `localStorage`/`sessionStorage`.** On any page open DevTools →
   Application → Local Storage and Session Storage: both empty. In the console,
   `localStorage.length === 0 && sessionStorage.length === 0` returns `true`.
   Under Cookies, `gameshelf_session` is present with `HttpOnly` and
   `SameSite=Lax`; `document.cookie` does not contain it.

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

# Server-side route protection
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://localhost:3000/           # 307 -> /login
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://localhost:3000/setup      # 307 -> /login (setup complete)
```

# Out of scope

- Automated frontend tests (Vitest/Playwright); this ticket uses the manual
  script above instead.
- Pagination UI — the catalog requests `limit=24` and renders that page only.
- Any change to the rewrite/env design or the SSR cookie-forwarding behavior.
