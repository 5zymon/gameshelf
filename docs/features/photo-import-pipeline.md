---
type: Feature
title: Photo Import Pipeline
description: The BullMQ worker's per-photo pipeline — one vision call, external validation, per-batch MySQL transactions, retry-only-unresolved, and photo deletion after completion.
tags: [import, worker, bullmq, igdb, vision]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-06T14:35:00Z }
---

# Overview

This is the ADR-002 unit of work: what actually happens to one uploaded photo
after [Import Photo Upload API](/import-upload-api.md) queues it. The BullMQ
`PhotoImportHandler` delegates to `PhotoImportPipelineService`, which:

1. calls the vision provider **once** for the photo;
2. persists the recognized item list;
3. validates each title against an external game database (IGDB);
4. saves confirmed games in one MySQL transaction per batch;
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
        commitImportBatch(jobId, outcome)           # ONE tx per batch
        if outcome has transient: retry, break
    result = summarizeRecognizedItems()
    markCompleted(jobId, result)                 # status done | needs_attention
    delete photo                                 # after markCompleted, for done AND needs_attention
    outcome = 'done' | 'needs_attention'
catch error:
  counts = summarizeRecognizedItems()            # partial work so far (pending counts as recognized)
  if not retryable OR last attempt: markFailed(reason, counts); outcome = 'failed'
  else: outcome = 'retry_scheduled'
  throw error (UnrecoverableError when permanent)
finally:
  log one JSON line: formatImportJobOutcome(
      { jobId, importJobId, photoRef, outcome, ...counts,
        durationMs, attempt, maxAttempts [, error] })
```

Key properties:

- **Batches.** `IMPORT_BATCH_SIZE = 10`, so a typical photo spans several
  batches. Killing the worker mid-job leaves every already-committed batch
  persisted.
- **Per-job timeout + cancellation.** The whole unit of work (`processJob`)
  runs under `withJobTimeout` (`IMPORT_JOB_TIMEOUT_MS = 300 s`). A job that
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
- **Timeout headroom (title ceiling).** The 300 s budget is sized for a shelf
  of up to ~50 titles: one vision call (`VISION_REQUEST_TIMEOUT_MS = 30 s`)
  plus ~50 sequential IGDB lookups at `IGDB_REQUEST_INTERVAL_MS = 300 ms` and
  up to `IGDB_REQUEST_TIMEOUT_MS = 5 s` each worst-cases at
  ≈ 30 s + 50 × 5.3 s ≈ 295 s. A photo recognized with substantially more than
  ~50 titles can exceed the timeout; it is retried, and on the last attempt
  marked `failed` with the partial counters.
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
- **Photo lifecycle.** The photo is deleted after the job reaches a terminal
  _completed_ state — both `done` and `needs_attention`, including zero-item
  recognition. A `failed` job keeps its photo. (The standalone sweep/cleanup of
  orphaned photos is ticket 3.8.)
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
with a single IGDB implementation, `IgdbGameCatalogResolver`:

- `IgdbClient` obtains an OAuth client-credentials token (cached until
  `expiry − 60 s`) and issues one `POST /v4/games` search per title;
- results are normalized (lowercase, diacritics/punctuation stripped,
  whitespace collapsed); the first exact normalized-name match wins, otherwise
  a containment match with a shorter/longer length ratio ≥ 0.8;
- a 429/5xx/network/timeout becomes `transient`, a 401/403 or malformed query
  becomes `unrecognized`, and no match becomes `unrecognized`.

A matched candidate is mapped to a seeded `Platform` row (IGDB id first, then
name/abbreviation/alternative name). When no seeded platform matches, the item
is flagged **unrecognized** with the stable reason token
`platform_not_in_catalog` (exported as `PLATFORM_NOT_IN_CATALOG_REASON`).

Trade-off: the status machine has no separate "needs platform seed" state, so a
catalog match whose platform is not seeded is treated as an unrecognized item
and surfaces as `needs_attention` for user review. This is deliberate — the
alternative would be silently dropping a real game — but it means an incomplete
platform seed (e.g. the initial IGDB platform seed is still pending) shows up as
review noise. The `reason` is a fixed, UI-translatable token rather than prose,
so the UI can render a dedicated message and the value stays stable if wording
changes.

The MobyGames fallback (ticket 4.5) and IGDB multiquery batching (ticket 4.3)
plug into the same port.

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
| Per-job timeout        | 300 s                 | `IMPORT_JOB_TIMEOUT_MS`          |
| Lock duration          | 360 s (> timeout)     | `IMPORT_JOB_LOCK_DURATION_MS`    |
| Lock renew time        | 180 s                 | `IMPORT_JOB_LOCK_RENEW_TIME_MS`  |
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
  "attempt": 1,
  "maxAttempts": 3
}
```

Fields: `jobId`, `importJobId`, `photoRef`, `outcome`
(`done` | `needs_attention` | `already_terminal` | `retry_scheduled` | `failed`),
the three counts, `durationMs`, `attempt`, `maxAttempts`, and `error` on a
failure/retry. The worker's own `onFailed` handler still logs the error stack for
a failed job.

# Out of scope

- MobyGames fallback (4.5) and IGDB multiquery batching (4.3).
- Manual item resolution (pick candidate / manual add).
- The orphaned-photo sweep (3.8).
- Frontend progress/flagged-item views.
