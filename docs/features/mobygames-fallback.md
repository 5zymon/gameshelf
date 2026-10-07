---
type: Feature
title: MobyGames Fallback
description: A rate-limited MobyGames v2 client that validates titles IGDB missed, maps them onto the shared CatalogCandidate shape, records MobyGames provenance, and degrades to IGDB-only when no key is configured.
tags: [import, validation, mobygames, rate-limit, catalog]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-07T08:05:26Z }
---

# Overview

Ticket 4.4 made the [Anti-hallucination Validation](/anti-hallucination-validation.md)
chain source-pluggable but registered only IGDB. Ticket 4.5 appends a second
source — **MobyGames v2** — so a title IGDB cannot confirm is given one more
chance before it is flagged `unrecognized`. The fallback is:

- consulted **only after IGDB returns `unrecognized`** (a `matched`, `transient`,
  or `config_error` from IGDB short-circuits the chain first);
- throttled to **1 request per rolling second** and a hard **720 requests per
  rolling hour**, which **waits** at the window boundary instead of firing past
  the budget;
- mapped onto the same `CatalogCandidate` shape as IGDB, so the
  [Photo Import Pipeline](/photo-import-pipeline.md) is unaware which source
  matched;
- **absent from the chain entirely when `MOBYGAMES_API_KEY` is unset**, so an
  unconfigured fallback degrades to IGDB-only and never fails a job.

# Authentication

MobyGames authenticates with an API key passed as the **`api_key` query
parameter** (not a header). The key is read only from the environment:

| Variable            | Required | Purpose                                                       |
| ------------------- | -------- | ------------------------------------------------------------- |
| `MOBYGAMES_API_KEY` | no       | API key for the `/v2/games` lookup; blank disables the source |

The key is never logged and never included in an error message — `MobygamesError`
carries a fixed, safe description. `.env.example` keeps `MOBYGAMES_API_KEY`
**commented out**: setting a placeholder would configure the source and turn a
rejected key into a queue pause (below).

# The lookup

One request per title, to the games collection endpoint:

```
GET https://api.mobygames.com/v2/games
    ?title=<title>&fuzzy=true&limit=10
    &include=id,title,genres.,platforms.,covers.
    &api_key=<key>
```

The documented `include` grammar uses a trailing dot to pull nested fields
(`genres.`, `platforms.`, `covers.`). The response body is
`{ "games": [ … ] }`; each `MobygameGame` carries `game_id`, `title`, and the
requested `genres`, `platforms` (with `release_date`, `releases[].release_date`,
`releases[].companies[]`), and `covers[].images[]`. Rows without a numeric
`game_id` and a string `title` are filtered out. A malformed body (not an object
with a `games` array) or malformed JSON is a **permanent** `MobygamesError`,
never an invented candidate.

# Candidate mapping

A MobyGames row is mapped onto the shared `CatalogCandidate` exactly like an IGDB
row, with `source: 'MobyGames'`:

| Field         | Source                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `externalId`  | `game_id`                                                                                            |
| `title`       | `title`                                                                                              |
| `releaseYear` | earliest four-digit year across `platforms[].release_date` and `platforms[].releases[].release_date` |
| `publisher`   | first `release.companies[]` whose `role` matches `/publish/i`, else the first `company_name`         |
| `genre`       | first `genres[].name`                                                                                |
| `coverUrl`    | first non-empty of `covers[].images[].image_url` / `original_url` / `thumbnail_url`                  |
| `platforms`   | `{ igdbId: null, name, abbreviation: null }` per `platforms[]`                                       |
| `raw`         | the raw `MobygameGame`                                                                               |

Each field degrades independently to `null` when the nested data is absent, so a
missing `include` field can never produce an invented value. `igdbId` is
deliberately `null`: Moby platform ids are **not** IGDB ids, so
`ImportJobsService.resolvePlatformId` skips the IGDB-id path and matches the
candidate's platform name (and the vision raw platform string) against the local
`platforms` table; a Moby-only name that matches nothing becomes
`platform_not_in_catalog` (`unrecognized`).

Acceptance reuses the shared `selectConfidentMatch` (normalized equality,
Levenshtein/containment ratio ≥ 0.8, and the version-token guard), so a sequel
such as `Halo` vs `Halo 2` is never accepted as a typo. No confident match yields
`{ kind: 'unrecognized', reason: 'No MobyGames game matched the title' }`, which
falls through to the end of the chain.

# Rate limiting

`MobygamesRateLimiter` (`mobygames-rate-limiter.ts`) is a single process-wide
provider exported from `GameCatalogModule`. Every request runs through
`schedule(fn)`, which enforces two rolling windows plus one concurrency slot:

- at most `MOBYGAMES_MAX_REQUESTS_PER_SECOND = 1` start per rolling
  `MOBYGAMES_SECOND_WINDOW_MS = 1000`;
- at most `MOBYGAMES_MAX_REQUESTS_PER_HOUR = 720` starts per rolling
  `MOBYGAMES_HOUR_WINDOW_MS = 3_600_000`;
- at most `MOBYGAMES_MAX_CONCURRENT_REQUESTS = 1` in flight.

Unlike `IgdbRateLimiter` there is **no queue-full rejection**: a task that would
breach either window **waits** (its `schedule()` promise stays pending) until the
oldest start leaves the window, then fires. The client therefore has **no
internal 429 retry loop** — the budget is enforced client-side, so a 429 becomes
a retryable `MobygamesError` that BullMQ's outer job retry handles. A request is
never fired and then retried on 429. The limiter cancels its pending wake-up on
`OnModuleDestroy`.

Consequence: a fallback-heavy import that must wait for the hourly budget can
exceed the per-job timeout (`IMPORT_JOB_TIMEOUT_MS = 300 s`). With
`IMPORT_MAX_ATTEMPTS = 3` and the BullMQ exponential backoff (base
`IMPORT_RETRY_BACKOFF_MS = 5 s`), the total retry horizon is only ~15 minutes
(≈ 3 × 300 s job time plus the 5 s/10 s backoffs), while a saturated 720 req/h
budget can make the limiter wait up to ~1 hour for a slot. Under sustained
saturation a job can therefore exhaust all attempts and terminate as a
**permanently `failed`** job — not merely "retried later". The budget itself is
never exceeded, but the fallback does not yet degrade per item: a single
budget-starved item blocks the batch and, on exhaustion, loses the whole job.
Item-level progress and retry handling (so a fallback-heavy import cannot be
failed as a unit) is tracked by ticket 4.9. A task already queued in the limiter
when a job is aborted still fires when its slot opens (no cancellation signal is
threaded through `GameCatalogResolver.resolve`).

# Source registration and degradation

`GameCatalogModule` builds the ordered source list with a pure helper:

```ts
catalogSourceList(igdb, mobygames, isMobygamesConfigured(config));
//  -> [igdb]                    when no key is configured
//  -> [igdb, mobygames]         when a key is configured
```

Two distinct failure cases are handled differently:

| Case                                   | Behaviour                                                                                                                                                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOBYGAMES_API_KEY` absent/blank       | The fallback is **not registered**. The chain is `[igdb]`; a title IGDB misses becomes `unrecognized` with an IGDB-only reason. No `config_error`, no pause, no failed job.                                                                         |
| Key present but rejected (`401`/`403`) | `MobygamesConfigError` → `{ kind: 'config_error', source: 'mobygames' }` → the chain short-circuits → the pipeline throws `ConfigurationImportError('mobygames', …)` and **pauses the queue**, exactly like a broken IGDB credential (ticket 3.10). |
| Present, `429` / `5xx` / network       | `transient` → the item stays `pending` and BullMQ retries.                                                                                                                                                                                          |
| Present, `200`, no confident match     | `unrecognized` → fall through to the end of the chain; the aggregated reason lists both sources.                                                                                                                                                    |

Because an absent key means the source is literally absent, the chain reports
IGDB as the only source when unconfigured (an IGDB-only miss reason contains no
MobyGames segment). This is why `.env.example` leaves the key commented.

# Provenance

A fallback match records `Game.source = 'MobyGames'`. `ImportJobsService.commitImportBatch`
now writes `source: item.candidate.source` (previously the hard-coded `'IGDB'`),
and the Prisma `GameSource` enum already contains `MobyGames`, so **no migration**
is needed. `ConfigErrorSource` gains `'mobygames'`; the `import_queue_state.source`
column is `VarChar(16)`, so it fits without a schema change.

# Administrative dependency

Free non-commercial MobyGames access is granted by **application** and is not
instant. Obtaining the key is an operational prerequisite that must start early;
until then the fallback stays disabled and imports validate against IGDB alone.

# Tests

- `mobygames.errors.spec.ts` (unit): status → error mapping (`401`/`403`
  config, `429`/`5xx` retryable, other permanent), no secret in messages.
- `mobygames-rate-limiter.spec.ts` (unit): 1 req/s, the 720-req/h budget waits
  under 725-task load, slot release, `activeCount`/`queuedCount`, injected clock,
  timer cancellation.
- `mobygames.client.spec.ts` (unit, fake HTTP seam): request shape, response
  parsing/filtering, limiter routing, absent-key config error, status mapping,
  malformed JSON/body, a body-read timeout (retryable), key non-leakage.
- `mobygames-game-catalog.resolver.spec.ts` (unit): label, candidate mapping
  (year/publisher/cover/platforms/`source`), unrecognized reason, sequel guard,
  `config_error`/`transient` mapping, malformed (null-element and unexpectedly
  shaped) nested payloads degrading to a candidate with empty fields /
  `unrecognized` instead of throwing, inherited sequential `resolveBatch`.
- `game-catalog.module.spec.ts` (unit): `catalogSourceList` unconfigured vs
  configured; an IGDB-only chain reports IGDB as the only source.
- `import-jobs.service.spec.ts` (unit): a fallback candidate is written with
  `source = MobyGames`.
- `photo-import-pipeline.spec.ts` (unit): a `mobygames` `config_error` pauses
  the queue and commits nothing.
- `photo-import.failure.spec.ts` (unit): `MobygamesConfigError` classifies as a
  `mobygames` config error, non-retryable, with its own message.
- `anti-hallucination.e2e-spec.ts` (e2e): a title IGDB misses and the fallback
  matches yields one `Game` with `source = MobyGames`, result `{1, 1, 0}`, and a
  `done` job, with IGDB consulted before the fallback.

# Out of scope

- The MobyGames health endpoint and recorded-fixture integration tests (4.9).
- Cover local caching (4.10/4.6) and re-enrichment (4.7).
- Platform alias creation; multi-instance budget sharing (the limiter is per
  process, like IGDB).
- Threading a cancellation signal into the resolver port to drop abandoned
  waiting tasks.
