---
type: Feature
title: Web API Client
description: One typed frontend API client and shared @gameshelf/contracts wire types, with centralised base URL, credentials, query builders, and a single ApiError.
tags: [web, api, types]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-07T18:00:00Z }
---

# Overview

`apps/web` talks to the [Auth API](/auth-api.md), [First-run Setup](/first-run-setup.md),
the catalog, platforms and import endpoints through **one typed client module**
at `apps/web/src/lib/api/`. Components no longer call the backend with a raw,
untyped `fetch`; every request goes through `createApiClient(transport)` and
rejects with a single typed `ApiError`.

The client gets its types from the `@gameshelf/contracts` npm workspace, which
mirrors the NestJS wire shapes (JSON: dates are `string`, nullable fields are
`T | null`). This keeps one definition of each contract for tickets 5.2–5.7
without importing the decorator-based Nest DTOs into the web bundle.

# Module layout

| File                   | Role                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `lib/api/contracts.ts` | Re-exports `@gameshelf/contracts`; the only module that imports the package.                          |
| `lib/api/errors.ts`    | `ApiError`, `isApiError`, `isGameConflict`, `apiErrorFromResponse`.                                   |
| `lib/api/query.ts`     | `buildQueryString`, `gamesListQuery`, `importJobsListQuery`.                                          |
| `lib/api/client.ts`    | `Transport`, `ApiRequestOptions`, `ApiClient`, `createApiClient`.                                     |
| `lib/api/server.ts`    | Server client (`API_ORIGIN` + forwarded cookie) and `getCurrentUser` / `getSetupStatus` / `getGames`. |
| `lib/api/browser.ts`   | Browser client (relative `/api`, `credentials: 'same-origin'`).                                       |
| `lib/api/index.ts`     | Isomorphic re-exports (contracts/errors/query/client) — never `server`/`browser`.                     |

# Base URL and credentials

Centralised in the `Transport`:

- **Server** (`server.ts`): `baseUrl` is `NEXT_PUBLIC_API_URL` (default
  `http://localhost:3001`); `getHeaders()` reads `next/headers` `cookies()` and
  forwards the `cookie` header; `cache: 'no-store'`. This is the only place
  `NEXT_PUBLIC_API_URL` is read on the web side (besides `next.config.mjs`).
- **Browser** (`browser.ts`): `baseUrl` is the relative `/api` prefix that
  Next rewrites to the API origin, with `credentials: 'same-origin'`. No
  `process.env`, so the API origin never reaches the browser bundle.

# Errors

Every non-2xx response becomes an `ApiError` carrying `status`, `url`, `body`
and `code`. `messages`/`userMessage` reproduce the Nest body shape
(`message: string | string[]`); non-JSON proxy bodies degrade to raw text; a
network failure uses `status: 0` and `code: 'NETWORK_ERROR'`. `isGameConflict()`
narrows a `409` carrying `code: 'GAME_ALREADY_IN_CATALOG'` and the existing
`game`. The login/setup forms map `401`/`400`/`409` to their existing messages.

# Endpoints

`createApiClient` exposes `games` (list, search, get, create, addCopy, update,
remove, enrich), `platforms` (list, get, create, update, confirm, merge,
remove, refresh), `importJobs` (list, get, getBatch, retry, resume,
listUnrecognized, dismiss, dismissUnrecognizedItem), `importUpload.upload`,
`settings.llm` (get, put, test), `settings.gameDatabases.status`, `auth`
(login, logout, me) and `setup` (status, create). Server-side fetching is the
default; client fetching is used only by the interactive login/setup/logout
forms and the settings/refresh controls.

# Related

- [Web Auth UI](/web-auth-ui.md) — the login/setup/logout call sites migrated to
  this client.
- [Single-Origin Frontend & API with Strict CSP](/single-origin-frontend-api.md)
  — the `/api` rewrite and same-origin cookie this client relies on.
- [Catalog API](/catalog-api.md), [Platforms API](/platforms-api.md),
  [Import Jobs API](/import-jobs-api.md) — the wire shapes in `contracts`.

# Out of scope

- A backend DTO refactor or importing the Nest classes into the web app.
- Codegen from Swagger, or any `packages/contracts` build artifact (source-only
  TS).
- A frontend test runner; verification is typecheck + lint + build plus the
  live-API OpenAPI comparison.
- UI for games, platforms and imports (tickets 5.2–5.7).
