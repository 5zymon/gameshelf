---
type: Feature
title: Auth API
description: Session-cookie login/logout/me endpoints plus the global SessionGuard that authenticates every request.
tags: [api, auth, security]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-05T00:00:00Z }
---

# Overview

The Auth API turns the [Auth Foundation](/auth-foundation.md) services into an
HTTP surface. `POST /auth/login` exchanges credentials for a server-side
session and an opaque, `httpOnly` cookie; `POST /auth/logout` revokes it; and
`GET /auth/me` returns the authenticated user. A single global
`SessionGuard` authenticates every request that is not explicitly opted out
with `@Public()`.

There is exactly **one permission level** — no roles, no permission checks
(decision #14). Any valid session is fully authorized.

# Endpoints

| Method | Path           | Auth        | Success | Body / result                        |
| ------ | -------------- | ----------- | ------- | ------------------------------------ |
| `POST` | `/auth/login`  | `@Public()` | `200`   | `{ user: { id, email, createdAt } }` |
| `POST` | `/auth/logout` | session     | `204`   | —                                    |
| `GET`  | `/auth/me`     | session     | `200`   | `{ id, email, createdAt }`           |

`POST /auth/login` accepts `{ email, password }` (both strings, `email` ≤ 255,
`password` ≤ 1024). It intentionally does **not** apply `@IsEmail()`: the
stored email was normalized but never format-validated, so login must accept
whatever was stored. Invalid payloads are rejected with `400` by the global
validation pipe; all other routes remain protected by default.

`POST /auth/logout` revokes the current session server-side: the underlying
delete is idempotent (`deleteMany` by the HMAC digest of the token, so an
unknown or already-revoked token is a no-op). The endpoint itself is not
idempotent over HTTP, however — it is guard-protected, so calling it without a
valid session returns `401`.

# Session cookie

The cookie is named `gameshelf_session` and carries the raw session token
(the database stores only its HMAC-SHA256 digest — see
[Auth Foundation](/auth-foundation.md)). Flags set on every issue and clear:

| Flag       | Value          | Rationale                                                   |
| ---------- | -------------- | ----------------------------------------------------------- |
| `httpOnly` | `true`         | JavaScript cannot read the token (XSS mitigation)           |
| `sameSite` | `Lax`          | Blocks cross-site state-changing requests (CSRF mitigation) |
| `secure`   | `cookieSecure` | TLS-only when the deployment sets it                        |
| `path`     | `/`            | Cookie valid for the whole API                              |
| `expires`  | session expiry | Matches the server-side sliding expiry                      |

`cookieSecure` comes from `SESSION_COOKIE_SECURE`. Accepted values are
`true`/`1` and `false`/`0` (case-insensitive); anything else fails config
loading at startup. It **defaults to `false`** so a plain-HTTP LAN install
works out of the box — operators on TLS set it to `true`. Weak `SameSite=Lax`
must not be relaxed to `None` without adding CSRF tokens.

The guard re-issues (slides) the cookie on every authenticated request so the
client expiry tracks the server-side sliding expiry returned by
`SessionsService.validate`.

# Global guard and @Public()

`SessionGuard` is registered once, in `AppModule`, via
`{ provide: APP_GUARD, useClass: SessionGuard }`, so **every** endpoint is
protected unless it opts out. It resolves the cookie, calls
`SessionsService.validate(token)`, and on success attaches:

- `req.user = { id }` — single permission level, no role/permission fields.
- `req.session = { token, expiresAt }`.

Failure modes return `401 Unauthorized`:

- no `gameshelf_session` cookie;
- the token is unknown or its server-side session is expired
  (`SessionsService.validate` deletes expired rows and returns `null`); the
  guard also clears the client cookie.

`@Public()` (metadata key `gameshelf:isPublic`) opts a controller or route out
of the guard. It is used by `POST /auth/login` and the root/`GET /health`
endpoints.

# Login error handling

Unknown emails and wrong passwords produce the identical `401` response with
the message `Invalid email or password`, so the two cases are
indistinguishable. For an unknown email the service still runs
`PasswordService.verify` against a fixed dummy Argon2id hash (`DUMMY_PASSWORD_HASH`)
to equalize response time and avoid a user-enumeration timing oracle.

# Configuration

| Env var                 | Required | Rule                                                       |
| ----------------------- | -------- | ---------------------------------------------------------- |
| `SESSION_SECRET`        | yes      | ≥ 32 characters; HMAC-SHA256 key for the stored session id |
| `SESSION_TTL_MINUTES`   | no       | Integer `1..525600`, default `10080`                       |
| `SESSION_COOKIE_SECURE` | no       | `true`/`1` or `false`/`0`, default `false`                 |

# Out of scope

- Self-registration is deliberately disabled: no public signup/register route
  exists, and the e2e regression test
  (`apps/api/test/e2e/no-registration.e2e-spec.ts`) asserts that
  `POST /auth/register` and similar paths return `404`. The one-time bootstrap
  endpoint is documented in [First-run Setup](/first-run-setup.md).
- Rate limiting.
- CSRF tokens (relying on `SameSite=Lax`) and account lockout.
- CORS credentials configuration (web integration, ticket 2.5).
- Web client wiring and multi-level roles/permissions.
