---
type: Feature
title: Import Jobs API
description: GET/PATCH/POST /import-jobs — persisted import runs with live status/counts, batch progress, retry, flagged-item review, post-review settling, dismissal, and the retention policy.
tags: [api, import]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-13T22:15:26Z }
---

# Overview

The import jobs API persists the results of photo imports (spec §5, import
history) so the import progress view and the flagged-item review have durable
records. ADR-005 settles the reason: the `import_jobs` table itself **is** the
queue, so a row is at once the mechanism and the record — the durable record is
never a copy of an external queue's state.
Every import run is one row of `import_jobs` (one row per uploaded photo,
ADR-005), and every item the vision model could not match is one row of
`unrecognized_items` with its raw recognized title (decision #12).

The API is read-mostly: the import pipeline (tickets 3.2/3.5) writes through
service methods on `ImportJobsService` (`createJob`, `markProcessing`,
`saveRecognition`, `commitImportBatch`, `markCompleted`, `markFailed`,
`addUnrecognizedItem`), and the user's only write path is dismissal. The
per-photo worker that drives those methods is documented in
[Photo Import Pipeline](/photo-import-pipeline.md). Job _creation_ over HTTP —
the multi-photo upload that calls `createJob` — is documented separately in the
[Import Photo Upload API](/import-upload-api.md).

# Endpoint contract

| Method  | Path                                           | Purpose                                                                                        | Success                          | Errors                     |
| ------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------- |
| `GET`   | `/import-jobs`                                 | List import runs with status and counts, newest first                                          | `200` `ListImportJobsResponse`   | `400`                      |
| `GET`   | `/import-jobs/batches/:batchId`                | Aggregate progress for one upload batch (X of Y photos)                                        | `200` `ImportBatchProgressModel` | `400`, `404`               |
| `GET`   | `/import-jobs/:id`                             | One run with ALL its unrecognized items (full trace)                                           | `200` `ImportJobDetailModel`     | `400`, `404`               |
| `POST`  | `/import-jobs/:id/retry`                       | Retry a failed run in place (re-runs only unresolved titles)                                   | `202` `ImportJobDetailModel`     | `400`, `404`, `409`, `503` |
| `POST`  | `/import-jobs/resume`                          | Resume a queue paused by a configuration error (idempotent)                                    | `200` `ImportQueueStateModel`    | `401`                      |
| `GET`   | `/import-jobs/:id/unrecognized`                | Flagged items awaiting review (non-dismissed only)                                             | `200` `UnrecognizedItemModel[]`  | `400`, `404`               |
| `GET`   | `/import-jobs/:id/unrecognized/:itemId/search` | Re-search the game database for a flagged item with a corrected title                          | `200` `GameSearchResponseModel`  | `400`, `404`, `409`, `503` |
| `PATCH` | `/import-jobs/:id`                             | Dismiss a needs-attention/failed job (`{"status":"dismissed"}`)                                | `200` `ImportJobDetailModel`     | `400`, `404`, `409`        |
| `PATCH` | `/import-jobs/:id/unrecognized/:itemId`        | Dismiss/acknowledge a flagged item (`{"dismissed":true}`)                                      | `200` `UnrecognizedItemModel`    | `400`, `404`               |
| `POST`  | `/import-jobs/:id/unrecognized/:itemId/pick`   | Pick a tied or re-searched candidate for a flagged item (creates a `Game`, dismisses the item) | `200` `GameDetailModel`          | `400`, `404`, `409`, `503` |

A flagged item can also be re-searched with a corrected title:
`GET /import-jobs/:id/unrecognized/:itemId/search?q=&platformId=` runs the same
debounce-protected catalog search as `GET /games/search` (`200`
`GameSearchResponseModel`), scoped to a live (non-dismissed) item — `404` for an
unknown or foreign item, `409` when already reviewed, `400` for a malformed or
unknown `platformId`, `503` while the source is down. `platformId` is a
preference, not a filter: candidates on it are listed first, catalog order
otherwise. Pick one with `POST …/pick` carrying the re-search `query` (lifts
the stored-tie requirement; the candidate is re-confirmed against a fresh
search for that query) and optionally the user-confirmed `platformId`, which
overrides photo/catalog platform resolution (`platformUnverified` false). The
`query` is trimmed before validation and must contain at least 2 letters or
digits after normalization — the same bar the search's minimum length uses —
otherwise the pick is a `400`.

`ImportJobModel` response shape:

```json
{
  "id": "01926f3a-8c4e-7b21-9d3f-2a6b8e4c1f70",
  "status": "needs_attention",
  "declaredCount": 12,
  "photoRef": "3f2a1c9e-....jpg",
  "recognizedCount": 11,
  "importedCount": 9,
  "unrecognizedCount": 2,
  "openFlaggedCount": 1,
  "pendingCount": 0,
  "needsAttention": true,
  "declaredCountMismatch": true,
  "batchId": "c1f0a4e2-...-9b3d",
  "errorMessage": null,
  "createdAt": "2026-10-05T10:00:00.000Z",
  "completedAt": "2026-10-05T10:05:00.000Z"
}
```

`declaredCount` is `null` when the user did not declare an item count;
`photoRef` is the opaque ephemeral filename set by
[Import Photo Upload API](/import-upload-api.md) (`null` for rows created
without a photo); `errorMessage` is set only for `failed` jobs (the reason
shown to the UI, spec §4.2.7); `completedAt` is stamped when the job leaves
`processing`.

Ticket 3.6 adds the computed progress fields:

- `pendingCount` — unresolved titles: recognized but neither imported nor
  flagged. For a terminal job it is `max(0, recognized − imported −
unrecognized)`; for a running job it is the live count of `pending`
  recognized items.
- `openFlaggedCount` — flagged items still awaiting review: the
  `unrecognized_items` rows of this job with `dismissed_at IS NULL`, counted
  live for **every** status (one `groupBy(['importJobId'])` for the whole list,
  no N+1). It is what the review UI acts on: it reaches `0` as items are
  dismissed, picked or added by hand, while `unrecognizedCount` keeps its
  historical value.
- `needsAttention` — `status === 'needs_attention'`, the status-derived flag
  for the review UI. It is truthful after review too: the settle step (below)
  moves a job to `done` once its last open flagged item is reviewed and no
  other trigger holds.
- `declaredCountMismatch` — terminal job whose `declaredCount` is set and
  differs from `recognizedCount` (the ticket 4.8 comparison; `needsAttention`
  is the status-derived flag the UI acts on).
- `batchId` — the upload batch this run belongs to
  ([Import Photo Upload API](/import-upload-api.md)); `null` for rows created
  without one.

`GET /import-jobs` returns `{ items, meta }` with `meta = { page, limit,
total, totalPages }` (`page` default 1, `limit` default 20, max 100,
`?status=` filter, `?batchId=` filter). Ordering is newest first: `createdAt
DESC` with an `id DESC` tiebreaker so bulk-created rows sharing a timestamp
stay deterministic (same pattern as the [Catalog API](/catalog-api.md)
sorting).

# Status lifecycle

| Status            | Set by              | Meaning                                                                                                           |
| ----------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `queued`          | pipeline            | Created for the photo (ticket 3.2); waiting for the queue                                                         |
| `processing`      | pipeline            | The processor picked the job up (ticket 3.5)                                                                      |
| `done`            | pipeline; or review | Completed with no needs-attention trigger — or the last open flagged item was reviewed and no other trigger holds |
| `needs_attention` | pipeline            | Completed with at least one trigger; awaits user review                                                           |
| `failed`          | pipeline            | The run failed; `errorMessage` carries the reason                                                                 |
| `dismissed`       | user                | User dismissed a `needs_attention`/`failed` job                                                                   |

Allowed transitions (anything else is a `409`):

| From                        | To                                                   |
| --------------------------- | ---------------------------------------------------- |
| `queued`, `processing`      | `processing` (idempotent re-entry on retry)          |
| `queued`, `processing`      | `done`, `needs_attention`, `failed`                  |
| `needs_attention`           | `done` (system, via `settleReviewedJob` — see below) |
| `failed`                    | `queued` (user-initiated retry)                      |
| `needs_attention`, `failed` | `dismissed`                                          |
| `dismissed`                 | (none)                                               |

**Post-review settling.** Dismissing a flagged item, picking a candidate and
adding a game by hand each call `settleReviewedJob(jobId)` **after** the
caller's claim has committed (not inside its transaction, so two racing reviews
of the last two items both count). It loads the job, counts the still-open
items, and — only while the job is `needs_attention` and the §4.2.4 rule is now
clear (`recognizedCount > 0`, `declaredCount` null or equal, zero open items) —
runs a guarded `updateMany({ where: { id, status: 'needs_attention' }, data: {
status: 'done' } })`. Stored counters and `completedAt` are untouched, and the
step is best-effort: a failure is logged and never surfaced, because the review
itself already succeeded. An old `needs_attention` row whose items were all
reviewed before this step existed is corrected by the next dismissal on any of
its items (the idempotent re-dismiss path also settles).

**Stays dismissed:** `dismissed` is a terminal state. The pipeline methods
(`markProcessing`, `markCompleted`, `markFailed`) refuse to touch any job
that is not `queued`/`processing` — a late or duplicate processor callback
can never clobber a user dismissal. Dismissal itself is idempotent:
re-dismissing a dismissed job is a `200` no-op.

**User retry is in-place.** A **user-initiated retry** (`POST
/import-jobs/:id/retry`, ticket 3.6) re-runs the **same** `import_jobs` row:
it resets `failed → queued` (clearing `errorMessage`/`completedAt`, and resetting
`attempts` to 0 so the row is runnable again), then wakes the in-process worker.
The pipeline's own
idempotency then guarantees correctness — `visionCompletedAt` prevents a
second vision call, `listPendingRecognizedItems` re-runs only `pending`
titles, and the `updateMany({ status: 'pending' })` claim in
`commitImportBatch` rolls a batch back instead of duplicating a `Game`. The
counters are left intact and recomputed by the pipeline. Only `failed` jobs
with a stored `photoRef` are retryable (`409` otherwise: `queued`/`processing`
are already in flight, `done`/`needs_attention`/`dismissed` have nothing
pending). The guarded `updateMany({ where: { id, status: 'failed' } })` makes
two concurrent retries safe. This is distinct from the worker's **automatic**
retry of a transient failure, which also re-runs the **same** row with
`attempts: 3`, leaving it `queued` (awaiting the backoff) between attempts (no
user action).

# Completion counts

`markCompleted(jobId, result)` receives the ADR-005 job result contract —
the three counts the processor reports — and persists them exactly as
reported (the API does not reconcile `unrecognized_count` against the item
rows; the processor is the source of truth):

```ts
interface JobCompletionResult {
  recognizedCount: number; // detected items — every outcome the model reported
  importedCount: number; // items saved to the catalog
  unrecognizedCount: number; // flagged items: recognized rows with status unrecognized
}
```

The service then computes `done` vs `needs_attention` server-side (single
source of truth for the status rule; the processor only reports numbers).
The three triggers are spec §4.2.4:

```
needsAttention =
    recognizedCount === 0
 || (declaredCount !== null && recognizedCount !== declaredCount)
 || unrecognizedCount > 0
```

1. **Zero items** — the model recognized nothing.
2. **Declared mismatch** — the user said "12 games" and the model found a
   different number.
3. **Any flagged item** — at least one item needs review.

Trigger 1 and trigger 3 are independent of `declaredCount`: with no declared
count the mismatch trigger stays off, and a clean recognition reports
`recognizedCount` (the recognized games) with `status: "done"` and
`needsAttention: false`. The model's advisory `count_visible` is never part of
this computation — it does not set or clear a flag.

`unrecognizedCount` counts the flagged `recognized_items` rows: those whose
validation status is `unrecognized` (a title no catalog source confirmed, or an
item with no usable platform name). A named platform that matches no existing
platform does **not** flag the item: the platform is created by the import and
the game is imported (spec §4.2.3/§4.6.6; see
[Platforms API](/platforms-api.md#import-created-platforms)). The
`platform_not_in_catalog` reason now means only "the item has no usable
platform name", not "the platform was not synced". There is **no** separate
`unreadable` status, enum, or column, and no placeholder row is ever written.
The recognition prompt (`VISION_INSTRUCTION_PROMPT`) instructs the model to
identify an item from its cover art when the printed text cannot be read, to
read the platform off the physical box/media banner, to return its canonical
name (a `PC DVD ROM` banner means `PC`), and never to infer the platform from
the title or cover art, so a returned item always carries a title and resolves
to `imported` or `unrecognized`. The two residual cases are not silent successes:

- A response containing an item with a missing/empty title is rejected
  **whole** by `parseRecognizedItems` as a non-retryable `bad_response`, so the
  job ends `failed` (with its reason shown to the UI) rather than storing a
  placeholder `raw_title`.
- An item the model omits entirely leaves no row to flag; it is detectable only
  when the user declared a count (trigger 2). The advisory `count_visible` is
  deliberately never used for the flag.

`raw_title` stays `NOT NULL` in the schema.

`unrecognizedCount` is the flagged total **at completion** and is never
decremented by review — it is the historical record of what the photo flagged.
The live "still to review" number is `openFlaggedCount` (see _Endpoint
contract_).

The failure path also carries counts: `markFailed(jobId, errorMessage, counts?)`
accepts the same `JobCompletionResult`, so a run that committed earlier batches
and then failed permanently persists the counters it reached (pending items
count as recognized) instead of leaving every column at 0. When omitted, the
counter columns are left untouched.

# Status is durable

`import_jobs.status` is the **only** status record (ADR-005): the worker's claim
writes `processing` durably, and during a backoff the row is `queued`. There is
no external queue state to merge and no state-fetch timeout — the API reports the
stored status as-is.

Counts follow the same split (ticket 3.6, decision D5): a terminal job reports
its **persisted** counters (the pipeline's source of truth); a non-terminal
job reports **live** counts aggregated from `recognized_items`
(`groupBy(['importJobId', 'status'])`), so a running import shows progress
before the counters are written. `pendingCount` is always derived
(`max(0, recognized − imported − unrecognized)` for terminal rows; the live
`pending` group otherwise). `openFlaggedCount` is the exception to the split:
it is always counted live from `unrecognized_items`, for terminal and running
rows alike.

# Batch progress

Every photo in one upload request shares a `batchId` (one `randomUUID()` per
request, stored on `import_jobs.batch_id`), so the multi-photo progress view
can report aggregate progress without polling each job:

- `GET /import-jobs?batchId=` filters the list to one batch.
- `GET /import-jobs/batches/:batchId` returns `ImportBatchProgressModel`:

```json
{
  "batchId": "c1f0a4e2-...-9b3d",
  "total": 5,
  "queued": 1,
  "processing": 1,
  "done": 2,
  "needsAttention": 1,
  "failed": 0,
  "dismissed": 0,
  "completedCount": 3,
  "pendingCount": 2,
  "allCompleted": false,
  "paused": false,
  "pauseReason": null,
  "pauseSource": null
}
```

The aggregate is one `groupBy(status)` over the durable rows:
`completedCount` is every photo that reached a terminal status and
`pendingCount` is `queued + processing` (the "X of Y" view); `allCompleted` is
`pendingCount === 0`. An unknown/empty batch is a `404` (not an empty-but-valid
batch). `batchId` is at most 64 chars (`400` otherwise).

Ticket 3.10 adds the queue pause fields: `paused` comes from the durable
`import_queue_state.paused` flag (ADR-005), and `pauseReason`/`pauseSource`
(`'llm' | 'igdb'`) come from the same row. See
[Queue Pause on Configuration Error](/queue-pause-on-config-error.md).

# Queue pause (ticket 3.10)

When a photo import hits a rejected/absent LLM or IGDB credential, the pipeline
fails the current photo and pauses the single `photo-import` queue, so no
further photo is processed. The pause and its reason are reported on
`GET /import-jobs/batches/:batchId` (`paused`, `pauseReason`, `pauseSource`).

`POST /import-jobs/resume` clears the pause and the stored reason and returns
`ImportQueueStateModel`:

```json
{ "paused": false, "reason": null, "source": null, "pausedAt": null }
```

It is idempotent — resuming an already-running queue is a `200` no-op — and
requires the normal session auth (`401` otherwise). Saving an LLM key
(`PUT /settings/llm`) also auto-resumes a queue paused by an `llm` config error
when `keyPresent` is true. A restart never auto-resumes, so a still-broken
configuration is not re-failed. Full behaviour in
[Queue Pause on Configuration Error](/queue-pause-on-config-error.md).

# Dismissal semantics

- **Job dismissal** — `PATCH /import-jobs/:id` with `{"status":"dismissed"}`
  is the only user-settable status. It is allowed from `needs_attention`
  and `failed` only (`409` otherwise: "Only needs-attention or failed jobs
  can be dismissed"), `404` for an unknown id, and idempotent (re-dismissal
  is a `200` no-op).
- **Item dismissal** — `PATCH /import-jobs/:id/unrecognized/:itemId` with
  `{"dismissed":true}` stamps `dismissed_at` (one-way; there is no
  un-dismiss, and `{"dismissed":false}` is a `400`). `404` if the item does
  not exist **or belongs to another job**. It is idempotent, and the re-dismiss
  path also runs the settle step, so it self-heals old rows.
- **Settling after review** — item dismissal, a candidate pick and a manual
  add each run `settleReviewedJob` after their write commits: when the last
  open flagged item is reviewed and no other §4.2.4 trigger holds, the job
  moves `needs_attention → done` (see _Status lifecycle_).
- **Review queue vs full trace** — `GET /import-jobs/:id/unrecognized` is
  the review queue and returns **non-dismissed** items only (spec §5:
  items "remain visible until the user resolves or dismisses them").
  `GET /import-jobs/:id` returns **all** items including dismissed — the
  full trace, which must outlive dismissal (spec §4.2.5).
- Dismissal is a **state change, not a deletion**: rows remain queryable
  (see Retention policy). "Resolution" — picking a tied or re-searched
  candidate (`POST …/pick`, card 105; optional re-search `query` and
  user-confirmed `platformId`) or manual add — creates a `Game` and dismisses
  the item in one guarded transaction.

# Retention policy

**`import_jobs` and `unrecognized_items` rows are kept indefinitely.**

- No TTL, no auto-deletion, no pruning job, and **no DELETE endpoint** for
  import runs or flagged items.
- This settles spec §5 ("import history … kept indefinitely — at this
  scale it is negligible") and §11.
- The uploaded photo is deleted after processing (spec §4.2.5), but "the
  trace must outlive the image" — the `unrecognized_items` rows (raw title,
  raw platform, reason) are what the user reviews later, so they cannot be
  tied to the photo's lifetime.
- **The rows are kept; the photos are not.** The
  [Photo Lifecycle & Retention](/photo-lifecycle.md) sweep removes the files
  behind terminal (`done`/`needs_attention`), `dismissed`,
  `failed`-past-retention, and abandoned `queued`/`processing` jobs (and any
  file with no owning row); when the sweep deletes a file it clears that job's
  `photoRef`, and a `failed` job whose 7-day retry window has passed is no
  longer retryable (`409`).
- Dismissal changes state, not existence: a dismissed job and its items
  stay in the list and detail views (filtered out of the review queue only).
- Any future pruning (e.g. archiving old runs) requires a spec change plus
  a migration; it is deliberately not built now.

# 400 semantics

The global `ValidationPipe` runs with `whitelist` + `forbidNonWhitelisted` +
`transform`:

- `:id` / `:itemId` must be UUIDv7 strings (`@IsUUID('7')`); `abc`, `0`,
  `1.5`, or a v4 UUID → `400`, and a well-formed unknown id → `404`.
- `GET /import-jobs` query params: `page`/`limit` integers ≥ 1 (`limit` ≤
  100); `status` must be one of the six lifecycle values; `batchId` a string
  of at most 64 chars; any unknown query param → `400`.
- `GET /import-jobs/batches/:batchId`: `batchId` is a string of at most 64
  chars (`400` otherwise), `404` when no job carries it.
- `PATCH /import-jobs/:id` body must be exactly `{"status":"dismissed"}` —
  any other value, missing field, or unknown property → `400`.
- `PATCH /import-jobs/:id/unrecognized/:itemId` body must be
  `{"dismissed":true}`; `{"dismissed":false}` → `400` (no un-dismiss).

# Out of scope

- **Photo upload / job creation via HTTP** (ticket 3.2) — documented in the
  [Import Photo Upload API](/import-upload-api.md); `createJob` is the service
  method it calls.
- **The processor itself** (ticket 3.5) — documented in
  [Photo Import Pipeline](/photo-import-pipeline.md); it calls
  `markProcessing` / `saveRecognition` / `commitImportBatch` /
  `markCompleted` / `markFailed`.
- **Item resolution** — pick a tied or re-searched candidate (`POST …/pick`,
  card 105) or manual add (frontend) are implemented; dismissal is the other
  state change.
  (User retry and batch progress are implemented; see _Status lifecycle_,
  _Status is durable_, and _Batch progress_.)
- **Auth guards** (2.x) and the **frontend views** — the API serves the
  data. The progress view is implemented ([Import Progress UI](/import-progress-ui.md));
  flagged-item review is implemented too (the same view's Photos list).
