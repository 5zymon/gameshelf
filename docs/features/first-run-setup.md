---
type: Feature
title: First-run Setup
description: One-time bootstrap API that reports whether setup is required and creates the very first account.
tags: [api, auth, bootstrap]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-05T00:00:00Z }
---

# Overview

A fresh GameShelf install has no accounts, and the [Auth API](auth-api.md)
only logs existing users in. The first-run setup surface closes that gap: it
reports whether the system still needs its first account and creates exactly
one. The window is derived from the `users` table itself, so once an account
exists the ability to create accounts through this path is gone permanently —
there is no flag to reset and nothing to re-open by URL.

Both routes are `@Public()`: the global `SessionGuard` would otherwise reject
a first-run request, which by definition has no session.

# Endpoints

| Method | Path            | Auth        | Success | Body / result                        |
| ------ | --------------- | ----------- | ------- | ------------------------------------ |
| `GET`  | `/setup/status` | `@Public()` | `200`   | `{ setupRequired: boolean }`         |
| `POST` | `/setup`        | `@Public()` | `201`   | `{ user: { id, email, createdAt } }` |

`GET /setup/status` returns `setupRequired: true` while the `users` table is
empty and `false` afterwards. It reveals only whether an account exists, never
any account data.

`POST /setup` accepts `{ email, password }` — the same shape and rules as
`POST /auth/login` (both strings; `email` ≤ 255; `password` ≤ 1024). Like
login it deliberately omits `@IsEmail()`, because creation has never
format-validated emails. A blank (whitespace-only) email or empty password is
rejected by the service with `400`; other validation failures are rejected by
the global validation pipe. Once an account exists, `POST /setup` returns
`409` with the message `Setup has already been completed`.

# One-shot guarantee

Setup state is not stored separately: it is exactly "is `users` empty?".
Creation is therefore a single atomic statement:

```sql
INSERT INTO users (email, password_hash)
SELECT ?, ? FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM users)
```

Two concurrent callers cannot both win — InnoDB serializes the inserts and the
second one affects zero rows, which maps to `409`. A cheap `hasAnyUser()`
pre-check short-circuits the already-completed case before any Argon2 hashing
runs. Under contention a losing caller can be rolled back before the winner's
row is visible to it; the insert is therefore retried up to three times, with a
`hasAnyUser()` re-check after each failure, so the loser still gets `409` rather
than a `500`. If every attempt fails and no user exists, the underlying error is
rethrown (a genuine failure is never masked as a conflict).

Deleting every user row re-enables setup; this is inherent to deriving state
from the table and matches the ticket.

# Shared creation logic

`POST /setup` and the CLI `user:create` both funnel through
`UsersService.prepareUser()`, the single source of truth for email
normalization (trim + lowercase), max-length bounds, blank/empty checks, and
Argon2id hashing. `createFirstUser()` adds the atomic emptiness guard;
`createUser()` performs a plain insert whose duplicate-email violation
(`P2002`) maps to `409`. The database unique index `users.email` enforces
uniqueness on both paths. See [User CLI](user-cli.md) for the operator
commands that use this same path.

# Logging

On success `SetupService` logs one info line with the Nest `Logger`:

```
First-run setup completed: created user <id> (<email>)
```

The password is never logged, and rejected attempts are not logged.

# Out of scope

- Rate limiting on the unauthenticated setup routes.
- Web client wiring.
- CLI account provisioning — shipped as [User CLI](user-cli.md)
  (`user:create` / `user:passwd`); it reuses the same service methods.
- Password policy/strength rules and multi-user roles (single permission
  level — decision #14).
