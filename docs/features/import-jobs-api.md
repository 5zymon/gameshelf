---
type: Feature
title: Import Jobs API
description: GET/PATCH /import-jobs — persisted import runs, flagged-item review, dismissal, and the retention policy.
tags: [api, import]
status: draft
generated: { by: opencode/home-model, at: 2026-10-05T18:07:16Z }
---

# Overview

The import jobs API persists the results of photo imports (spec §5, import
history) so the import progress view and the flagged-item review have durable
records. ADR-002 settles the reason: the queue (BullMQ + Redis) is the
mechanism, not the record — "Do not treat Redis contents as an audit log."
Every import run is one row of `import_jobs` (one row per uploaded photo,
ADR-002), and every item the vision model could not match is one row of
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

| Method  | Path                                    | Purpose                                                         | Success                         | Errors              |
| ------- | --------------------------------------- | --------------------------------------------------------------- | ------------------------------- | ------------------- |
| `GET`   | `/import-jobs`                          | List import runs with status and counts, newest first           | `200` `ListImportJobsResponse`  | `400`               |
| `GET`   | `/import-jobs/:id`                      | One run with ALL its unrecognized items (full trace)            | `200` `ImportJobDetailModel`    | `400`, `404`        |
| `GET`   | `/import-jobs/:id/unrecognized`         | Flagged items awaiting review (non-dismissed only)              | `200` `UnrecognizedItemModel[]` | `400`, `404`        |
| `PATCH` | `/import-jobs/:id`                      | Dismiss a needs-attention/failed job (`{"status":"dismissed"}`) | `200` `ImportJobDetailModel`    | `400`, `404`, `409` |
| `PATCH` | `/import-jobs/:id/unrecognized/:itemId` | Dismiss/acknowledge a flagged item (`{"dismissed":true}`)       | `200` `UnrecognizedItemModel`   | `400`, `404`        |

`ImportJobModel` response shape:

```json
{
  "id": 1,
  "status": "needs_attention",
  "declaredCount": 12,
  "photoRef": "3f2a1c9e-....jpg",
  "recognizedCount": 11,
  "importedCount": 9,
  "unrecognizedCount": 2,
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

`GET /import-jobs` returns `{ items, meta }` with `meta = { page, limit,
total, totalPages }` (`page` default 1, `limit` default 20, max 100,
`?status=` filter). Ordering is newest first: `createdAt DESC` with an `id
DESC` tiebreaker so bulk-created rows sharing a timestamp stay
deterministic (same pattern as the [Catalog API](/catalog-api.md) sorting).

# Status lifecycle

| Status            | Set by   | Meaning                                                   |
| ----------------- | -------- | --------------------------------------------------------- |
| `queued`          | pipeline | Created for the photo (ticket 3.2); waiting for the queue |
| `processing`      | pipeline | The processor picked the job up (ticket 3.5)              |
| `done`            | pipeline | Completed with no needs-attention trigger (see below)     |
| `needs_attention` | pipeline | Completed with at least one trigger; awaits user review   |
| `failed`          | pipeline | The run failed; `errorMessage` carries the reason         |
| `dismissed`       | user     | User dismissed a `needs_attention`/`failed` job           |

Allowed transitions (anything else is a `409`):

| From                        | To                                          |
| --------------------------- | ------------------------------------------- |
| `queued`, `processing`      | `processing` (idempotent re-entry on retry) |
| `queued`, `processing`      | `done`, `needs_attention`, `failed`         |
| `needs_attention`, `failed` | `dismissed`                                 |
| `dismissed`                 | (none)                                      |

**Stays dismissed:** `dismissed` is a terminal state. The pipeline methods
(`markProcessing`, `markCompleted`, `markFailed`) refuse to touch any job
that is not `queued`/`processing` — a late or duplicate processor callback
can never clobber a user dismissal. Dismissal itself is idempotent:
re-dismissing a dismissed job is a `200` no-op. A **user-initiated retry**
(ticket 3.6) enqueues a **new** `import_jobs` row, never re-runs the old one
(ADR-002: the queue's unit of work is the photo; a retry enqueues a fresh
unit). This is distinct from BullMQ's **automatic** retry of a transient
failure, which re-runs the **same** row with `attempts: 3` and leaves it
`processing` between attempts.

# Completion counts

`markCompleted(jobId, result)` receives the ADR-002 job result contract —
the three counts the processor reports — and persists them exactly as
reported (the API does not reconcile `unrecognized_count` against the item
rows; the processor is the source of truth):

```ts
interface JobCompletionResult {
  recognizedCount: number; // detected items — every outcome the model reported
  importedCount: number; // items saved to the catalog
  unrecognizedCount: number; // flagged items: unrecognized + unreadable
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

Note for ticket 3.5: `unrecognizedCount` counts **flagged** items, i.e.
unrecognized **plus unreadable** (ADR-002 result contract: "number flagged
as unrecognized"). That is what makes trigger 3 fire for unreadable items.
Also note: `raw_title` is `NOT NULL` in the schema while spec §4.2.3 has an
_Unreadable_ outcome with no title — the processor must store a
placeholder/empty string for unreadable items.

The failure path also carries counts: `markFailed(jobId, errorMessage, counts?)`
accepts the same `JobCompletionResult`, so a run that committed earlier batches
and then failed permanently persists the counters it reached (pending items
count as recognized) instead of leaving every column at 0. When omitted, the
counter columns are left untouched.

# Dismissal semantics

- **Job dismissal** — `PATCH /import-jobs/:id` with `{"status":"dismissed"}`
  is the only user-settable status. It is allowed from `needs_attention`
  and `failed` only (`409` otherwise: "Only needs-attention or failed jobs
  can be dismissed"), `404` for an unknown id, and idempotent (re-dismissal
  is a `200` no-op).
- **Item dismissal** — `PATCH /import-jobs/:id/unrecognized/:itemId` with
  `{"dismissed":true}` stamps `dismissed_at` (one-way; there is no
  un-dismiss, and `{"dismissed":false}` is a `400`). `404` if the item does
  not exist **or belongs to another job**.
- **Review queue vs full trace** — `GET /import-jobs/:id/unrecognized` is
  the review queue and returns **non-dismissed** items only (spec §5:
  items "remain visible until the user resolves or dismisses them").
  `GET /import-jobs/:id` returns **all** items including dismissed — the
  full trace, which must outlive dismissal (spec §4.2.5).
- Dismissal is a **state change, not a deletion**: rows remain queryable
  (see Retention policy). "Resolution" (pick a candidate / manual add) is
  ticket 3.6 and will extend the item model if needed.

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
- Dismissal changes state, not existence: a dismissed job and its items
  stay in the list and detail views (filtered out of the review queue only).
- Any future pruning (e.g. archiving old runs) requires a spec change plus
  a migration; it is deliberately not built now.

# 400 semantics

The global `ValidationPipe` runs with `whitelist` + `forbidNonWhitelisted` +
`transform`:

- `:id` / `:itemId` are transformed with `class-transformer` and must be
  integers ≥ 1; `abc`, `0`, or `1.5` → `400`.
- `GET /import-jobs` query params: `page`/`limit` integers ≥ 1 (`limit` ≤
  100); `status` must be one of the six lifecycle values; any unknown query
  param → `400`.
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
- **Retry endpoint** (3.6) — a retry enqueues a new job; the old row is
  never mutated.
- **Item resolution** (pick candidate / manual add, 3.6) — dismissal is the
  only item state change for now.
- **Auth guards** (2.x) and the **frontend views** — the API serves the
  data; the progress view and flagged-item review are frontend tickets.
