---
type: Feature
title: Photo Import Pipeline
description: The BullMQ worker's per-photo pipeline — one vision call, external validation, per-batch MySQL transactions, retry-only-unresolved, and photo deletion after completion.
tags: [import, worker, bullmq, igdb, vision]
status: draft
generated: { by: opencode/home-model, at: 2026-10-10T19:55:01Z }
---

# Overview

This is the ADR-002 unit of work: what actually happens to one uploaded photo
after [Import Photo Upload API](/import-upload-api.md) queues it. The BullMQ
`PhotoImportHandler` delegates to `PhotoImportPipelineService`, which:

1. calls the vision provider **once** for the photo;
2. persists the recognized item list;
3. validates each title against the ordered external-source validation chain
   (IGDB, then the optional MobyGames fallback);
4. maps each confirmed candidate to `Game` data (caching its cover locally) and
   saves the batch in one MySQL transaction;
5. records unrecognized titles as `unrecognized_items`;
6. maintains the job counters and persists the result;
7. deletes the photo only after the job reaches completion.

The persisted read side is the [Import Jobs API](/import-jobs-api.md); the
vision contract is [Vision Provider Abstraction](/vision-provider-abstraction.md).

# Data model

New in ticket 3.5:

- `import_jobs.vision_completed_at` — set in the same transaction that persists
  the item list. A non-null marker proves the single vision call already
  happened, so a retry never repeats it.
- `recognized_items` — one row per recognized title, keyed
  `(import_job_id, position)`:
  `status` is `pending` → `imported` | `unrecognized`, with `game_id` set for
  imported rows and `reason` for flagged rows. The `pending` claim is what
  makes each item importable exactly once.

`Game` gains a `recognized_items` back-relation; `ImportJob` gains
`recognized_items` (both `onDelete` safe: cascade from the job, `SET NULL` to a
deleted game).

# Algorithm

```
jobId    = payload.importJobId ?? lookup by photoRef
state    = getPipelineJob(jobId)          # terminal -> return stored counts
markProcessing(jobId)
outcome  = 'failed'
try:
  withJobTimeout(IMPORT_JOB_TIMEOUT_MS):  # bounds + aborts the unit of work
    if state.visionCompletedAt == null:
        read photo -> vision.recognize()    # the ONE vision call
        saveRecognition()                   # marker + rows, one transaction
    loop:
        pending = listPendingRecognizedItems()
        if none: break
        batch   = pending[0..IMPORT_BATCH_SIZE]     # batch size 10
        outcome = resolveBatch(batch)               # external calls OUTSIDE any tx
        commitImportBatch(jobId, outcome)           # cover cache + ONE tx per batch
        if outcome has transient: retry, break
    result = summarizeRecognizedItems()
    markCompleted(jobId, result)                 # status done | needs_attention
    delete photo                                 # after markCompleted, for done AND needs_attention
    outcome = 'done' | 'needs_attention'
catch error:
  counts = summarizeRecognizedItems()            # partial work so far (pending counts as recognized)
  if configErrorSource(error) != null:           # rejected/absent LLM or IGDB credential (3.10)
      markFailed(reason, counts); pauseForConfig(source, reason)
      throw UnrecoverableError
  if not retryable OR last attempt: markFailed(reason, counts); outcome = 'failed'
  else: outcome = 'retry_scheduled'
  throw error (UnrecoverableError when permanent)
finally:
  log one JSON line: formatImportJobOutcome(
      { jobId, importJobId, photoRef, outcome, ...counts,
        durationMs, visionDurationMs, attempt, maxAttempts [, error] })
```

Key properties:

- **Batches.** `IMPORT_BATCH_SIZE = 10`, so a typical photo spans several
  batches. Killing the worker mid-job leaves every already-committed batch
  persisted.
- **Enrichment and covers.** `commitImportBatch` delegates the candidate→`Game`
  mapping to `GameEnrichmentService.enrichCandidate`; the cover download happens
  **outside** the DB transaction (so a slow download never holds a MySQL
  transaction open) and the saved `coverUrl` is a same-origin
  `/api/covers/<file>` path. A failed download leaves `coverUrl` null without
  failing the item. See [Game Metadata Enrichment](/game-metadata-enrichment.md).
- **Per-job timeout + cancellation.** The whole unit of work (`processJob`)
  runs under `withJobTimeout` (`IMPORT_JOB_TIMEOUT_MS = 420 s`). A job that
  exceeds it rejects with `RetryableImportError`, so it fails cleanly and is
  retried, and the last attempt marks it `failed`. The timeout also **aborts**
  an `AbortController` threaded through `processJob` → `processBatches` →
  `resolveBatch`: the abandoned attempt checks `signal.aborted` before each
  batch iteration, before each external lookup, and before committing a batch,
  and unwinds with the same retryable error. `commitImportBatch` additionally
  refuses to write when the job is already terminal (`failed`/`done`/
  `needs_attention`), so an abandoned attempt cannot mutate the DB after
  `markFailed` or collide with the retry. The terminal transitions
  (`markCompleted`/`markFailed`) only update a row that is still `queued` or
  `processing`, so a late writer can never clobber a newer terminal status.
- **Timeout headroom (title ceiling).** The 420 s budget is sized for a shelf
  of up to ~50 titles: one vision call (`VISION_REQUEST_TIMEOUT_MS = 120 s`)
  plus ~50 sequential IGDB lookups paced by the central rate limiter
  ([IGDB Client & Rate Limiter](/igdb-client.md), 4 req/s, 8 concurrent, so a
  single sequential path waits ~250 ms per request) with up to
  `IGDB_REQUEST_TIMEOUT_MS = 5 s` each, worst-casing at
  ≈ 120 s + 50 × 5.25 s ≈ 383 s. (Upstream `429`s are retried inside the client,
  bounded and small relative to the budget.) A photo recognized with
  substantially more than ~50 titles can exceed the timeout; it is retried, and
  on the last attempt marked `failed` with the partial counters.
- **Idempotency.** Importing a title creates the `Game` and claims its
  `recognized_item` via `updateMany({ status: 'pending' })`; a zero-row claim
  throws so the batch rolls back. The **same guarded claim** runs for a flagged
  title before its `UnrecognizedItem` is created, so a duplicate/late
  processing of an already-flagged item rolls back instead of writing a second
  trace row. Re-running a job therefore never duplicates catalog rows or
  flagged items. A zero-row claim (a concurrent/abandoned attempt already
  resolved the item) is a **benign race** and is thrown as
  `RetryableImportError`: it schedules a retry instead of permanently failing a
  job that is actually succeeding.
- **Retry-only-unresolved.** A transient external failure (IGDB 429/timeout/
  network) makes the pipeline throw `RetryableImportError`; the job row stays
  `processing` and BullMQ retries. On re-entry only `pending` items are
  queried, and the vision marker prevents a second vision call.
- **Failure counters.** A permanent failure (or the last attempt) persists the
  counters reached so far: `markFailed` receives the same three counts as
  `markCompleted`, computed by `summarizeRecognizedItems` (pending items count
  as recognized). A job whose first batch committed and whose later batch
  failed therefore still reports its imports instead of showing 0.
- **Permanent failures stop BullMQ.** A non-retryable error is re-thrown as
  BullMQ's `UnrecoverableError` after `markFailed`, so BullMQ does not schedule
  the remaining attempts. A `RetryableImportError` is re-thrown unchanged so
  retries proceed.
- **Configuration errors pause the queue.** A rejected/absent LLM or IGDB
  credential (ticket 3.10) is a distinct `config_error` outcome, not an ordinary
  permanent failure: `resolveBatch` throws `ConfigurationImportError` **before**
  committing the batch, `run` marks the current photo `failed`, calls
  `QueueControlService.pauseForConfig(source, reason)`, and throws
  `UnrecoverableError`. The single queue is left paused so no further photo
  starts, and `configErrorSource()` makes the error non-retryable. See
  [Queue Pause on Configuration Error](/queue-pause-on-config-error.md).
- **Photo lifecycle.** The photo is deleted after the job reaches a terminal
  _completed_ state — both `done` and `needs_attention`, including zero-item
  recognition. A `failed` job keeps its photo while it is retryable. The
  standalone backstop sweep is implemented in
  [Photo Lifecycle & Retention](/photo-lifecycle.md): it removes a leftover
  file when the pipeline's delete failed, cleans up `dismissed` jobs (which
  never delete), and removes `failed`/abandoned photos once their retention
  window passes.
- **Single vision call.** The `vision_completed_at` marker plus a transaction
  guarantee one vision call per job for sequential retries. A timed-out attempt
  is cancelled at the abort boundary, so it cannot start another external
  lookup, a second vision call, or commit another batch while the retry runs.
  An overlapping stalled re-delivery across two workers is out of scope:
  concurrency is pinned to 1 (`PHOTO_IMPORT_CONCURRENCY`) and
  `lockDuration > jobTimeout`, so a live attempt holds its lock for the whole
  permitted run.

# External validation

`GameCatalogResolver` is a port (an abstract class used as the Nest DI token)
whose production binding is the ordered anti-hallucination chain,
`ChainedGameCatalogResolver`: it tries the injected `GAME_CATALOG_SOURCES` in
registration order (array order = validation order) and returns the first
`matched` candidate. A title no source confirms is never returned as a candidate
and therefore never saved as a `Game`; see
[Anti-hallucination Validation](/anti-hallucination-validation.md) for the
invariant, the `transient` short-circuit, and the `UnrecognizedItem` trace.
The chain registers `IgdbGameCatalogResolver` (`label = 'IGDB'`) first and, when
`MOBYGAMES_API_KEY` is set, `MobygamesGameCatalogResolver`
(`label = 'MobyGames'`) second; with no key the fallback source is not registered
and validation is IGDB-only. Either way the pipeline is unchanged; see
[MobyGames Fallback](/mobygames-fallback.md).

The IGDB source:

- `IgdbClient` obtains an OAuth client-credentials token (cached until
  `expiry − 60 s`, token URL defaulting to the Twitch endpoint) and issues one
  `POST /v4/games` search per title; every call goes through the central
  [IGDB Client & Rate Limiter](/igdb-client.md) (4 req/s, 8 concurrent), and an
  upstream `429` is retried inside the client with bounded exponential backoff
  before it ever reaches the pipeline;
- results are normalized (lowercase, diacritics/punctuation stripped,
  whitespace collapsed) and scored by a shared similarity function
  (`title-match.ts`): normalized equality scores 1, otherwise a Levenshtein
  ratio (boosted by containment) must reach `CONFIDENT_MATCH_MIN_SCORE = 0.8`.
  A minor typo such as `Haloo` → `Halo` (0.8) or `Pokeman` → `Pokemon` (0.857)
  is accepted; a query that follows a `: ` / `-` separator in the candidate
  name — a franchise prefix, e.g. `Dawn of War III` inside
  `Warhammer 40,000: Dawn of War III` — scores `SUFFIX_MATCH_SCORE = 0.95`. The
  query must have at least two tokens and a separator is required, so a single
  generic word (`War`) or an unseparated prefix (`New Super Mario Bros`) cannot
  latch on, and a tie between two such candidates is treated as ambiguous
  (unrecognized); a title that differs only by an
  installment/version token
  (`Fifa 24` vs `Fifa 23`, `Halo` vs `Halo 2`, `GTA V` vs `GTA IV`) scores 0 and
  is never treated as a typo, so it stays unresolved rather than matching the
  wrong game;
- a non-`429` 5xx/network/timeout — or a `429` whose internal retries are
  exhausted — becomes `transient` and is retried by the job; a 401/403 (or
  missing `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`, both raised as
  `IgdbConfigError`) becomes `config_error` and pauses the queue (ticket 3.10,
  [Queue Pause on Configuration Error](/queue-pause-on-config-error.md)); a
  malformed query becomes `unrecognized`, and a no-match becomes `unrecognized`
  with one of three reasons that name the case:
  - `No IGDB game matched the title` — IGDB returned no candidates at all;
  - `IGDB returned candidates but none matched the title closely enough` — a
    real candidate was rejected by the confidence threshold;
  - `Multiple IGDB candidates matched equally well (A, B, C) — choose one` —
    two or more candidates tied at the same score (e.g. two franchise-prefix
    suffix matches); the item is flagged with its `candidates` array populated
    so the user can pick one (card 105).

The MobyGames source mirrors this shape: `MobygamesClient` issues one
`GET /v2/games?title=…&fuzzy=true&limit=10&include=…&api_key=…` per title through
its own 1 req/s / 720 req/h limiter, which **waits** at a window boundary rather
than rejecting or firing-then-`429`-retrying; a `401`/`403` becomes
`config_error` (pausing the queue), `429`/`5xx`/network becomes `transient`, and
no confident match becomes `unrecognized`. The source is present only when
`MOBYGAMES_API_KEY` is set. See [MobyGames Fallback](/mobygames-fallback.md).

Because `transient` means "unknown", the chain **stops** at the first
`transient` instead of falling through (a real title must not be permanently
dropped while a source is merely throttled/down); only an `unrecognized` outcome
moves on to the next source. A `config_error` (rejected/absent credentials)
short-circuits the chain the same way, so a broken source is never masked by a
fallback and the queue pause happens immediately. Once every source has returned
`unrecognized`, the chain emits one aggregated reason preserving each source's
label, e.g.
`No game matched the title in any source — IGDB: No IGDB game matched the title`.

A matched candidate is mapped to a local `Platform` row with the platform read
off the physical item (`rawPlatform`) **authoritative**. The raw platform string
is expanded by `expandPlatformInputs` into its canonical equivalents first — PC
media-banner notations (`PC DVD ROM`, `PC-DVD-ROM`, `PC (Windows)`,
`Microsoft Windows`) expand to `PC` then `PC (Microsoft Windows)`, with the
literal input last — and that ordered list is matched first, so the canonical
row wins. `findPlatformMatch` stays **pure** and equality-only (both index and
input keys are the plain normalizer), so the synonym set can never rewrite or
collide the table and `platforms:sync`, which does not use the expansion, is
unaffected. Because the raw platform is authoritative, the external catalog can
never substitute a different platform. Only when the raw platform is null/blank
does resolution fall to the candidate's own name/abbreviation, then to the
candidate's canonical IGDB id: the **first candidate in catalog order** that
maps to a seeded platform, never an arbitrary lowest-local-id pick. All matching
is over the platform's name/abbreviation/alternative name **and aliases**
(case-, diacritic-, punctuation-, and whitespace-insensitive, so `PS5` and
`PlayStation 5` resolve to the same row; aliases carry old/merged-away names;
near-misses never match). Matching makes **no** IGDB platform-list call — the
list is refreshed out of band with `npm run platforms:sync`
([Platforms API](/platforms-api.md)). When the photo names a platform the local
list does not know, the import **creates** one from the raw photo string (then
the first candidate name, then the candidate abbreviation), flagged
`addedByImport` for review (spec §4.2.3/§4.6.6), rather than silently falling
back to a candidate platform. The normalized name is deduplicated against
reference, custom, and previously import-created platforms and their aliases,
and the queue is sequential, so two items with the same unknown name in one
import share exactly one new platform. The item is flagged **unrecognized**
with the stable reason token `platform_not_in_catalog` (exported as
`PLATFORM_NOT_IN_CATALOG_REASON`) only when there is no usable platform name at
all. Residual limitation: if the canonical PC row is absent, different banner
spellings (`PC DVD ROM` vs `PC CD ROM`) are not collapsed against each other and
can each create a flagged `addedByImport` row, reconciled later by review/merge.

`resolvePlatformId` now returns `{ platformId, provenance }` instead of a bare id, where `provenance` is `'photo'` when the platform was read off the physical item (matched, or created from the photo string) and `'catalog'` when it was inferred from the candidate's own platform list because the photo gave no usable platform. The commit path writes `Game.platformUnverified = true` exactly for the `'catalog'` case and `false` for `'photo'`, so a platform that was a silent guess from the external catalog (e.g. a game whose `raw_platform` was NULL and whose first IGDB platform is PlayStation 4) is surfaced by the existing danger chip on the game detail page rather than appearing confirmed. The `platform_not_in_catalog` unrecognized path (no usable name at all) still creates no `Game`, and the flag is still cleared by a `PATCH` that sets `platformId` and by a successful re-enrichment (see [Game Re-enrichment](/game-reenrichment.md)).

Trade-off: an import-created platform is committed immediately during
resolution, outside the batch transaction, so a batch that later fails can
leave a flagged, game-less platform behind. It is still reviewable,
confirmable, and mergeable, which matches "keep the import unattended". The
`platform_not_in_catalog` `reason` is a fixed, UI-translatable token rather
than prose, so the UI can render a dedicated message and the value stays
stable if wording changes.

The MobyGames fallback (ticket 4.5) appends a source to the same chain and is
consulted only after IGDB returns `unrecognized`. The IGDB
source retains its batched `resolveBatch()` (ticket 4.3), which resolves many
titles in two phases — a batched `/v4/multiquery` id search (≤10 sub-queries per
request) then a batched `/v4/games` hydration (≤500 ids per request). The chain
does not override that method, however, so through the `GameCatalogResolver`
port batches currently fall back to the inherited sequential per-item
`resolve()`; the pipeline still calls the per-title `resolve()`, so production
request reduction via batch integration remains **deferred** (it is not part of
ticket 4.4).

# Retry configuration

Job defaults come from the registered queue's `defaultJobOptions`
(`photoImportDefaultJobOptions()`): BullMQ `attempts: 3` and exponential
`backoff` (`IMPORT_RETRY_BACKOFF_MS = 5000` → 5 s, then 10 s). Worker options
(`photoImportWorkerOptions()`, ticket 3.7) bound each attempt:

| Setting                | Value                 | Constant                         |
| ---------------------- | --------------------- | -------------------------------- |
| Concurrency            | 1 (ADR-002)           | `PHOTO_IMPORT_CONCURRENCY`       |
| Attempts               | 3 total               | `IMPORT_MAX_ATTEMPTS`            |
| Backoff                | exponential, base 5 s | `IMPORT_RETRY_BACKOFF_MS`        |
| Per-job timeout        | 420 s                 | `IMPORT_JOB_TIMEOUT_MS`          |
| Lock duration          | 480 s (> timeout)     | `IMPORT_JOB_LOCK_DURATION_MS`    |
| Lock renew time        | 240 s                 | `IMPORT_JOB_LOCK_RENEW_TIME_MS`  |
| Stalled-check interval | 30 s                  | `IMPORT_JOB_STALLED_INTERVAL_MS` |
| Max stalled recoveries | 2                     | `IMPORT_JOB_MAX_STALLED_COUNT`   |

The **lock outlives the whole permitted job** (`lockDuration > jobTimeout`), so a
live worker cannot lose its lock mid-job and a second worker can never process
the same job concurrently. A killed worker's lock stops being renewed and expires
after at most `lockDuration`; the next stalled check moves the job back to
`waiting` and re-runs it (recovery within roughly
`lockDuration + stalledInterval`). Because the pipeline is idempotent, the re-run
never duplicates a saved game or a second vision call. These settings are
compile-time constants, not environment variables.

The pipeline marks a job `failed` only on a non-retryable error or on the last
attempt; until then it stays `processing`. A non-retryable error is re-thrown as
BullMQ `UnrecoverableError` so BullMQ stops immediately; a `RetryableImportError`
is re-thrown unchanged so the remaining attempts run. Either way the failure path
persists the counters reached so far. On timeout the attempt is cancelled
(`AbortController`) rather than merely abandoned, and `commitImportBatch`
refuses to write once the job is terminal, so a retry that starts during the
backoff cannot collide with the previous attempt. `markCompleted` and
`markFailed` write conditionally from `queued`/`processing` only, so a late
writer cannot clobber a newer terminal status.

A **user-initiated retry** (`POST /import-jobs/:id/retry`, ticket 3.6) resets
the same failed row to `queued` and enqueues a fresh BullMQ unit with the same
`importJobId`, so it re-enters exactly this pipeline. It reuses the
retry-only-unresolved path unchanged: the `vision_completed_at` marker skips a
second vision call and only `pending` titles are re-resolved, which is why a
retry never duplicates an already-saved game. See
[Import Jobs API](/import-jobs-api.md) for the endpoint contract.

# Structured logging

Every pipeline invocation emits exactly one JSON line through the Nest `Logger`
(`logger.log` for `done` / `needs_attention` / `already_terminal`, `logger.warn`
for `failed` / `retry_scheduled`), produced by the pure
`formatImportJobOutcome()`:

```json
{
  "event": "photo_import_job",
  "jobId": "12",
  "importJobId": 7,
  "photoRef": "….png",
  "outcome": "done",
  "recognizedCount": 12,
  "importedCount": 12,
  "unrecognizedCount": 0,
  "durationMs": 8421,
  "visionDurationMs": 7980,
  "attempt": 1,
  "maxAttempts": 3
}
```

Fields: `jobId`, `importJobId`, `photoRef`, `outcome`
(`done` | `needs_attention` | `already_terminal` | `retry_scheduled` | `failed`),
the three counts, `durationMs` (whole attempt), `visionDurationMs` (wall time of
the single vision call this attempt made — present even when the call threw, so a
`timeout` shows how long the provider actually ran; omitted when the attempt made
no vision call because the `vision_completed_at` marker already existed),
`attempt`, `maxAttempts`, and `error` on a failure/retry. The worker's own
`onFailed` handler still logs the error stack for a failed job.

# Out of scope

- Pipeline integration of batched resolution (`resolveBatch`) is deferred (not
  part of 4.4).
- Frontend progress/flagged-item views (implemented; see
  [Import Progress UI](/import-progress-ui.md)).
