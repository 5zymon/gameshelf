---
type: Feature
title: IGDB Client & Rate Limiter
description: One IGDB client that authenticates via Twitch client credentials, caches/refreshes the token, funnels every call through a central 4 req/s / 8-concurrent limiter, backs off on 429, and exposes an unauthenticated health probe.
tags: [igdb, external-api, oauth, rate-limit, health]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-06T14:49:32Z }
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
- fetches the full canonical platform list in one `POST /v4/platforms` page for
  the [Platforms API](/platforms-api.md) sync command;
- exposes a non-throwing `GET /health/igdb` connectivity/token probe.

The client is consumed by [Photo Import Pipeline](/photo-import-pipeline.md)
through the `GameCatalogResolver` port; the contract is unchanged.

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
treats a missing `expires_in` as `3600 s`.

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
or secret throws a permanent `IgdbError` without sending anything.

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

# Testing

All suites fake the HTTP seam (`IgdbHttpClient`) and make no external call:
`igdb.client.spec.ts` (token cache/refresh, single-flight acquisition, bootstrap
warm-up, token URL default/override, limiter routing, 429 backoff and
Retry-After, exhaustion, secret non-leakage, health outcomes, and platform-list
fetch — exact request body, malformed-row filtering, non-array error, limiter
routing),
`igdb-rate-limiter.spec.ts` (4/s window, 8 concurrent, slot release, bounded
queue, `activeCount`), `igdb-health.service.spec.ts`,
`igdb-health.controller.spec.ts`, and `igdb-health.e2e-spec.ts` (unauthenticated
`200` for both bodies).

# Out of scope

- MobyGames fallback (4.5) and IGDB multiquery batching (4.3).
- Multi-instance sharing: the limiter and token cache are per process, so the
  app assumes a single API instance (or accepts that each instance enforces its
  own limits).
