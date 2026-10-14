---
type: Reference
title: Configuration & External Services
description: LLM (OpenAI-compatible vision), IGDB and MobyGames credentials, and every variable in the root .env file.
tags: [operations, configuration, env, llm, igdb, mobygames]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-14T11:52:50.449Z }
---

# Overview

What GameShelf reads from the environment and which external credentials photo import needs. `.env.example` is the template; this page explains each variable.

# External services (LLM, IGDB, MobyGames)

Photo import calls an LLM (vision) and validates titles against IGDB, with an
optional MobyGames fallback. You obtain all three sets of credentials yourself.
**None are required to run the app** — they are only needed for import/enrichment.

## LLM (vision) — required for photo import

Recognition calls one OpenAI-compatible endpoint, configured **at runtime** in
Settings (`PUT /settings/llm`) — no env edit or restart:

- **Base URL** — required; set in Settings only (no env fallback).
- **Model** — stored in Settings, or the `LLM_MODEL` env override.
- **Key** — stored encrypted in Settings, or the `CUSTOM_API_KEY` env fallback.
  Local servers accept any non-empty value.
- **Encryption secret** — `LLM_SETTINGS_SECRET` derives the AES-256-GCM key for
  the stored key; falls back to `SESSION_SECRET`.

Recognition is enabled only when a base URL and a key are both available;
otherwise uploads are refused with `503`.

Verify a key with the live test `POST /settings/llm/test`
(`ok` / `unauthorized` / `not_configured` / …). See
[LLM Settings API](/llm-settings-api.md).

## IGDB — required for title validation

IGDB is reached via **Twitch OAuth client credentials**. Create a Twitch
application (https://dev.twitch.tv/console/apps, no scopes) and copy its Client
ID + Secret:

| Variable             | Required | Purpose                                    |
| -------------------- | -------- | ------------------------------------------ |
| `IGDB_CLIENT_ID`     | yes      | Twitch client id (sent as `Client-ID`)     |
| `IGDB_CLIENT_SECRET` | yes      | Twitch client secret (token endpoint only) |
| `IGDB_TOKEN_URL`     | no       | Token endpoint override (default Twitch)   |

The secret is never logged or surfaced in errors. Check with `GET /health/igdb`
(`{"status":"ok","token":"cached"}` or `acquired`). See [IGDB Client & Rate Limiter](/igdb-client.md).

## MobyGames — optional fallback

Consulted only for titles IGDB missed. It is **absent from the chain entirely
when `MOBYGAMES_API_KEY` is unset**, so an unconfigured fallback degrades to
IGDB-only and never fails a job.

> **⚠️ Approval step — start early.** Free non-commercial MobyGames access is
> granted **by application and is not instant**. Request it at
> https://www.mobygames.com/ and wait for approval before you need it. Until then
> leave `MOBYGAMES_API_KEY` **commented out**. Do **not** set a placeholder: a
> configured-but-rejected key (`401`/`403`) **pauses the photo-import queue**
> exactly like a broken IGDB credential.

| Variable            | Required | Purpose                                     |
| ------------------- | -------- | ------------------------------------------- |
| `MOBYGAMES_API_KEY` | no       | MobyGames v2 key; blank disables the source |

See [MobyGames Fallback](/mobygames-fallback.md).

# Environment variables

All variables live in a single root `.env` file (see `.env.example`):

| Variable                        | Used by    | Purpose                                                                                                                                                                            |
| ------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                      | both       | Runtime environment                                                                                                                                                                |
| `API_PORT`                      | `apps/api` | API listen port (default `3001`)                                                                                                                                                   |
| `API_HOST`                      | `apps/api` | API bind address (blank = every interface; `127.0.0.1` keeps it off the LAN)                                                                                                       |
| `WEB_PORT`                      | `apps/web` | Web listen port for `dev`/`start` (default `3000`)                                                                                                                                 |
| `WEB_HOST`                      | `apps/web` | Web bind address (blank = every interface, reachable from the LAN)                                                                                                                 |
| `NEXT_PUBLIC_API_URL`           | `apps/web` | Internal API origin for the `/api` rewrite and SSR (never called by the browser); blank derives it from `API_PORT`                                                                 |
| `MYSQL_PORT`                    | compose    | Host port compose publishes MySQL on (default `3306`); must match `DATABASE_URL`                                                                                                   |
| `MYSQL_DATABASE`                | compose    | Database compose creates on first init (default `gameshelf`); must match `DATABASE_URL`                                                                                            |
| `MYSQL_USER`                    | compose    | App user compose creates on first init (default `gameshelf`); must match `DATABASE_URL`                                                                                            |
| `MYSQL_PASSWORD`                | compose    | Password for that user; must match `DATABASE_URL`                                                                                                                                  |
| `MYSQL_ROOT_PASSWORD`           | compose    | MySQL root password (compose only)                                                                                                                                                 |
| `DATABASE_URL`                  | `apps/api` | Prisma connection string (utf8mb4)                                                                                                                                                 |
| `DATABASE_SHADOW_URL`           | `apps/api` | Prisma shadow DB (migrate dev only)                                                                                                                                                |
| `DATABASE_TEST_URL`             | `apps/api` | E2E test database, tests only (default `gameshelf_test` on `127.0.0.1:3306`)                                                                                                       |
| `PRISMA_LOG_QUERIES`            | `apps/api` | `1` logs every SQL statement the API runs (dev aid; default off)                                                                                                                   |
| `SESSION_SECRET`                | `apps/api` | HMAC-SHA256 key for session tokens (≥32 chars)                                                                                                                                     |
| `SESSION_TTL_MINUTES`           | `apps/api` | Sliding session lifetime in minutes (default `10080`; no "never")                                                                                                                  |
| `SESSION_COOKIE_SECURE`         | `apps/api` | Send the session cookie only over HTTPS (`true`/`1` or `false`/`0`, default `false`)                                                                                               |
| `CUSTOM_API_KEY`                | `apps/api` | API key for the OpenAI-compatible vision endpoint (fallback when no encrypted DB key is stored)                                                                                    |
| `LLM_MODEL`                     | `apps/api` | Vision model override when none is stored                                                                                                                                          |
| `LLM_SETTINGS_SECRET`           | `apps/api` | Key-derivation secret for the stored API key's AES-256-GCM key (falls back to `SESSION_SECRET`)                                                                                    |
| `IMPORT_PHOTOS_DIR`             | `apps/api` | Ephemeral upload directory (default `<OS temp>/gameshelf-import-photos`); the pipeline deletes a photo after its job completes and a sweep removes leftovers (see Photo Lifecycle) |
| `COVERS_DIR`                    | `apps/api` | Durable cover-cache directory (default `~/.gameshelf/covers`); saves a same-origin `/api/covers/<file>` and serves generated thumbnails at `/api/covers/thumbs/<file>`             |
| `COVER_PREVIEW_HOSTS`           | `apps/api` | Comma list of hosts the local cover cache and the signed `/api/covers/preview` passthrough may fetch (default `images.igdb.com,www.mobygames.com,mobygames.com`)                   |
| `COVER_PREVIEW_SECRET`          | `apps/api` | HMAC key for preview URLs (falls back to `SESSION_SECRET`)                                                                                                                         |
| `COVER_RETRY_SWEEP_INTERVAL_MS` | `apps/api` | Background cover-retry interval in ms (default `900000`)                                                                                                                           |
| `IGDB_CLIENT_ID`                | `apps/api` | IGDB credentials                                                                                                                                                                   |
| `IGDB_CLIENT_SECRET`            | `apps/api` | IGDB credentials                                                                                                                                                                   |
| `IGDB_TOKEN_URL`                | `apps/api` | Optional OAuth token endpoint override (default `https://id.twitch.tv/oauth2/token`)                                                                                               |
| `MOBYGAMES_API_KEY`             | `apps/api` | Optional MobyGames fallback key; blank = fallback disabled, IGDB-only                                                                                                              |

`WEB_PORT`/`WEB_HOST` are read by `apps/web/scripts/run-next.mjs`, which passes them
to `next dev`/`next start` as `--port`/`--hostname`; Next's own `PORT`/`HOSTNAME` are
not used. A variable exported in the shell overrides `.env` (e.g.
`WEB_PORT=4000 npm run dev`). Next inlines `NEXT_PUBLIC_*` at build time, so run
`npm run build` again after changing `API_PORT` or `NEXT_PUBLIC_API_URL` for `npm start`.
