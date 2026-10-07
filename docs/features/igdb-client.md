---
type: Feature
title: IGDB Client & Rate Limiter
description: One IGDB client that authenticates via Twitch client credentials, caches/refreshes the token, funnels every call through a central 4 req/s / 8-concurrent limiter, backs off on 429, resolves many titles with two-phase batching (batched id search + batched hydration), and exposes an unauthenticated health probe.
tags: [igdb, external-api, oauth, rate-limit, health, search]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-06T16:10:35Z }
---

# Overview

The photo import pipeline resolves every recognized title against IGDB (ticket
3.5). Ticket 4.1 turns that access into a single, well-behaved client:

- authenticates with Twitch **OAuth client credentials**;
- sends `Client-ID` and `Authorization: Bearer <token>` on every IGDB call;
- caches the token and refreshes it automatically one minute before expiry,
  acquiring it single-flight and warming it up (non-blocking) on bootstrap;
- funnels **all** IGDB traffic through one central limiter (4 requests per
  rolling second, at most 8 concurrent, bounded queue);
- retries an upstream `429` internally with bounded exponential backoff;
- searches for a title with `POST /v4/games` and looks up many titles with
  two-phase batching — a batched `/v4/multiquery` id search (at most 10
  sub-queries per request) followed by a batched `/v4/games` hydration (at most
  500 ids per request);
- fetches the full canonical platform list in one `POST /v4/platforms` page for
  the [Platforms API](/platforms-api.md) sync command;
- exposes a non-throwing `GET /health/igdb` connectivity/token probe.

The client is consumed by [Photo Import Pipeline](/photo-import-pipeline.md)
through the `GameCatalogResolver` port; the per-title `resolve()` contract is
unchanged. The IGDB source retains its batched `resolveBatch()` capability, but
the production binding — `ChainedGameCatalogResolver` — does not override it, so
through the port batch resolution currently falls back to the inherited
sequential per-item `resolve()`. Wiring the batched path into the pipeline is
**deferred** (it is not part of ticket 4.4).

# Authentication

Credentials are read only from the environment — never from the database, a
request, or a log line:

| Variable             | Required | Purpose                                                                 |
| -------------------- | -------- | ----------------------------------------------------------------------- |
| `IGDB_CLIENT_ID`     | yes      | Twitch application client id, sent as `Client-ID` on every IGDB request |
| `IGDB_CLIENT_SECRET` | yes      | Twitch application secret, sent only to the token endpoint              |
| `IGDB_TOKEN_URL`     | no       | OAuth token endpoint override                                           |

`IGDB_TOKEN_URL` defaults to the canonical Twitch endpoint
`https://id.twitch.tv/oauth2/token`; set it only to route through a proxy or a
mock. The secret appears solely in the token request body and is **never**
included in an error message — `IgdbError` carries a fixed, safe description.

The token request is `POST` with `Content-Type:
application/x-www-form-urlencoded` and body
`client_id=…&client_secret=…&grant_type=client_credentials`. A successful
response supplies `access_token` (or `token`) and `expires_in`; the client
treats a missing `expires_in` as `3600 s`. A `2xx` token response that carries
neither token field (for example a misconfigured `IGDB_TOKEN_URL` proxy or mock
returning `{}`) is a **configuration failure**: it throws `IgdbConfigError`, the
same class as a rejected credential, so it surfaces as `503` on manual search and
a config-error pause on import rather than a silent empty result.

# Token caching and refresh

`IgdbClient` holds one in-memory token (`value`, `expiresAt`). A call reuses it
while `expiresAt > now`; otherwise it acquires a new one. `expiresAt` is
`now + (expires_in − 60) s`, so the token is refreshed one minute before it
would actually expire.

Acquisition is **single-flight**: concurrent callers share one in-flight
`tokenPromise`, so a burst of calls (for example the health probe racing an
import) performs exactly one token-endpoint request and every waiter receives
the same token.

The token is also warmed up eagerly on application bootstrap
(`OnApplicationBootstrap`), so a cold process does not pay the token round-trip
on its first real request. The warm-up is **non-blocking** (`void this.warmUp()`)
and never rejects: it is skipped under the test runner (`NODE_ENV=test`) and when
the credentials are absent, and on failure it only logs a safe `IgdbError`
message. Application boot therefore still cannot fail on missing or unreachable
credentials. Credentials are validated before any request: a missing client id
or secret throws an `IgdbConfigError` (a permanent `IgdbError` subclass) without
sending anything. A token-endpoint rejection (`400`/`401`/`403`, or any other
non-`429`/`5xx` status, e.g. a wrong `IGDB_TOKEN_URL` returning `404`) and a
`2xx` response without a token are also `IgdbConfigError`, so the caller maps
them to `config_error` (HTTP `503` on search, a config-error pause on import)
instead of a permanent request error that an empty search would swallow.

# Central rate limiter

`IgdbRateLimiter` (`igdb-rate-limiter.ts`) is a single process-wide provider
exported from `GameCatalogModule`. Every IGDB request — token acquisition and
game search alike — is run through `schedule(fn)`, which:

- admits at most `IGDB_MAX_REQUESTS_PER_SECOND = 4` starts per rolling
  `IGDB_RATE_WINDOW_MS = 1000` window;
- keeps at most `IGDB_MAX_CONCURRENT_REQUESTS = 8` requests in flight;
- queues the rest (up to `IGDB_MAX_QUEUED_REQUESTS = 100` waiting tasks) and
  wakes on a timer when the window frees; once the queue is full a further
  `schedule()` rejects immediately with `IGDB rate limiter queue is full`
  instead of growing without bound (the client wraps that as a retryable
  `IgdbError`, and the health probe catches it);
- cancels its pending wake-up timer on `OnModuleDestroy`, so module shutdown is
  not delayed by a scheduled pump.

The limiter's limits are compile-time constants, not environment variables.
Concurrency `8` is unused by today's sequential pipeline but is enforced
centrally so future batching (ticket 4.3) stays within the cap.

# 429 backoff

`IgdbClient.send()` wraps one logical request in a bounded retry:

- on `429`, retry up to `IGDB_MAX_ATTEMPTS = 3` total attempts;
- delay is an exponential base of `IGDB_RETRY_BASE_DELAY_MS = 500 ms`
  (`500 ms`, then `1000 ms`) plus random jitter up to
  `IGDB_RETRY_JITTER_MS = 250 ms`, capped at `IGDB_RETRY_MAX_DELAY_MS = 5000 ms`;
- an HTTP `Retry-After` header (seconds or HTTP-date) is honored instead, also
  capped at 5 s and without jitter;
- a non-`429` error, or exhaustion of the attempts, throws the existing
  `IgdbError`; a 429 maps to a **retryable** error, so BullMQ's outer job retry
  (not this client) still applies after the internal retries are used up.

Internal retry is deliberately 429-only; timeouts, network failures and 5xx
remain the job-level engine's responsibility.

# Health check

`GET /health/igdb` (unauthenticated, `@Public()`) returns the `IgdbHealth` body
and never fails the HTTP request:

```json
{ "status": "ok", "token": "cached" }
```

- `token: "cached"` — a valid token was already in memory; no network call is
  made, and the probe deliberately does **not** force a refresh.
- `token: "acquired"` — no valid cached token, so one was obtained.
- `status: "error"`, `token: "error"` — credentials are missing or the token
  endpoint failed; `message` is a safe description that never contains the
  secret.

The endpoint returns HTTP `200` for both `ok` and `error`, unlike
[`GET /health/queue`](/photo-import-pipeline.md), which is `503` on failure:
IGDB being unreachable is a reportable state, not a reason to fail the probe.

# Platform list fetch

`fetchPlatforms()` (ticket 4.2) fetches the canonical platform list in **one**
`POST https://api.igdb.com/v4/platforms` with the body
`fields name,abbreviation,alternative_name,platform_family,slug; limit 500;`.
It reuses the cached token and the central limiter and retries a `429` exactly
like `searchGames`; a non-array body is a permanent `IgdbError`. Rows without a
numeric `id` and string `name` are filtered out. The result is consumed by the
[Platforms API](/platforms-api.md) sync command to populate/refresh the local
`platforms` table (matching PS5/PlayStation 5 and storing `platform_family`);
it is deliberately **not** called on a per-game import.

# Game search and multi-query batching

`searchGames(title)` (ticket 3.5) looks up one title with `POST /v4/games`.
`multiqueryGames(titles)` (ticket 4.3) looks up many titles in **two phases**,
because IGDB's `multiquery` has a known limitation.

## Why two phases

An IGDB `POST /v4/multiquery` sub-query that uses `search` **ignores `fields`**
and returns only ids (confirmed by the Twitch/IGDB UserVoice bug and
Cookie285/game-collection#10, merged 2026-09-28). Asking a `search` sub-query for
`involved_companies.company.name` and the other enrichment fields therefore
yields id-only rows that the catalog cannot use, so the client separates fuzzy
matching from field hydration instead of requesting the full field set in phase
one.

## Phase 1 — batched fuzzy search (ids only)

At most `IGDB_MULTIQUERY_MAX_QUERIES = 10` sub-queries are packed per
`POST /v4/multiquery` request (11 titles → requests of 10 then 1). Each
sub-query is named `g0`, `g1`, … in input order and requests only ids:

```
query games "g0" {
search "Halo";
fields id;
limit 10;
};
query games "g1" { … };
```

Results are attributed back to the input title by that sub-query name. Named
responses (`gN`) are authoritative; the positional fallback is used **only**
when the whole response is the older array-of-arrays shape. A partially named
response (an unnamed entry mixed with `g0`) therefore cannot shift an id onto
the wrong title — the unnamed entry is ignored — and a missing or malformed
`result` becomes an empty id list. Titles are escaped through
`escapeApicalypse`, which also strips C0/DEL control characters before escaping
quotes and backslashes.

## Phase 2 — batched hydration (catalog fields)

The unique ids from every phase-1 chunk (deduplicated across titles in
first-seen order) are hydrated with the full catalog field set in
`POST /v4/games` requests of at most `IGDB_HYDRATION_MAX_IDS = 500` ids:

```
fields name,first_release_date,cover.url,involved_companies.company.name,
genres.name,platforms.id,platforms.name,platforms.abbreviation,summary,
version_parent,multiplayer_modes.offlinemax,multiplayer_modes.onlinemax,
multiplayer_modes.offlinecoopmax,multiplayer_modes.onlinecoopmax;
where id = (1,2,…); limit 500;
```

The response rows are indexed `id → game`, and each title's candidates are
rebuilt from its phase-1 id order, so `multiqueryGames` still returns one
candidate array per input title, in input order. An id that hydration does not
return is **dropped** — the client never substitutes a different game.
Hydration asks for exactly the catalog fields (no `*`, no `alternative_names`);
`involved_companies.company.name` feeds `CatalogCandidate.publisher`,
`genres.name` feeds `CatalogCandidate.genre`, and the requested
`multiplayer_modes.*` maxima feed `CatalogCandidate.playerCount` (the maximum of
`offlinemax`/`onlinemax`/`offlinecoopmax`/`onlinecoopmax` across modes, or `null`
when none is present — see
[Game Metadata Enrichment](/game-metadata-enrichment.md)). `summary`/
`version_parent`/`multiplayer_modes` are archived through
`CatalogCandidate.raw`.

## Requests, tokens, errors

Both phases reuse the cached token, resolved once per HTTP request
(`authedRequest` → `getToken`, which returns `Promise.resolve` of a valid token)
and run through the central limiter: one HTTP request is one limiter slot, and a
`429` is retried per request by the same `send()` backoff. A 100-title batch is
therefore 10 multiquery requests plus at most 2 hydration requests (≤1000 unique
ids / 500).

Error semantics are batch-level: a non-array multiquery **or** hydration body is
a permanent `IgdbError` (`IGDB returned an unexpected response`), and any failing
request throws so the caller can classify the whole batch (the resolver marks
every item `transient` for a retryable error and `unrecognized` otherwise).
`multiqueryGames([])` sends no request.

## Known limitation: cross-system version tokens (m4)

The version-token guard treats numerals and roman numerals as installment
markers, so a title whose only difference is the _system_ scores 0 and is
reported `unrecognized`: `GTA 5` vs `GTA V`, `Final Fantasy 7` vs
`Final Fantasy VII`. This is an intentional false negative in the safe
direction — it never force-matches a different edition — and applies equally to
the [MobyGames fallback](/mobygames-fallback.md) (ticket 4.5).

The guard operates on whitespace-separated tokens, so a digit glued to a word —
a candidate literally named `Halo2` or `FIFA23` — is **not** treated as a
version token and is not covered by the guard. IGDB's canonical names use a
space (`Halo 2`, `FIFA 23`), so this is a deliberate, low-risk accepted
limitation rather than a bug.

# Testing

All suites fake the HTTP seam (`IgdbHttpClient`) and make no external call:
`igdb.client.spec.ts` (token cache/refresh, single-flight acquisition, bootstrap
warm-up, token URL default/override, limiter routing, 429 backoff and
Retry-After, exhaustion, secret non-leakage, health outcomes, platform-list
fetch — exact request body, malformed-row filtering, non-array error, limiter
routing, and two-phase `multiqueryGames` — 0/2/10/11-title packing, ids-only
phase 1 vs full-field hydration, named/mixed/omitted/legacy attribution, dedupe
and drop-unknown hydration, multi-chunk input order, escaping, empty input, 429
retry, non-array error),
`title-match.spec.ts` (normalization, exact/typo/unrelated similarity,
sequel/version guards, ranking, confident-match selection),
`igdb-rate-limiter.spec.ts` (4/s window, 8 concurrent, slot release, bounded
queue, `activeCount`), `igdb-health.service.spec.ts`,
`igdb-health.controller.spec.ts`, and `igdb-health.e2e-spec.ts` (unauthenticated
`200` for both bodies).

# Out of scope

- The MobyGames fallback is a **separate** source in the same chain and its own
  client/limiter — see [MobyGames Fallback](/mobygames-fallback.md). Wiring
  `resolveBatch()` into the pipeline is deferred (not part of 4.4).
- Multi-instance sharing: the limiter and token cache are per process, so the
  app assumes a single API instance (or accepts that each instance enforces its
  own limits).
