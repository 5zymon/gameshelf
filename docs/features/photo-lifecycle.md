---
type: Feature
title: Photo Lifecycle & Retention
description: Uploaded photos are ephemeral — kept while a job is queued, active, or retryable, deleted when it completes, and swept once orphaned or past the failed-retry window.
tags: [import, storage, retention, cleanup]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-06T15:00:00Z }
---

# Overview

Decision #4 (photos are ephemeral) plus ADR-002 ordering: a retry may still
need the image, so a photo is never deleted at first save, only once the job is
no longer going to run. This document is the single lifecycle reference; the
upload side is [Import Photo Upload API](/import-upload-api.md), the worker is
[Photo Import Pipeline](/photo-import-pipeline.md), and the durable records are
[Import Jobs API](/import-jobs-api.md).

The happy path is handled by the pipeline itself: `processJob` calls
`markCompleted` and then deletes the photo, so a `done` or `needs_attention`
job's image is gone as soon as processing finishes. A backstop sweep
(`PhotoSweepService`) removes everything the pipeline cannot guarantee: a file
whose delete failed, a `dismissed` job (dismissal never deletes), a `failed`
job past its retry window, an abandoned `queued`/`processing` run, and a file
written before its `import_jobs` row existed.

# Storage model

Photos live in `IMPORT_PHOTOS_DIR` (default `<OS temp>/gameshelf-import-photos`,
blank/absent falls back to the default). `photoRef` on `ImportJob` is a bare
UUID filename (extension derived from the mimetype). The API has **no static
mount and no gallery route** — no endpoint returns the bytes; the directory is
a hand-off buffer between the upload request and the worker.

# Lifecycle (state → photo)

| Job status                                                                  | Photo                                     | Removed by                  |
| --------------------------------------------------------------------------- | ----------------------------------------- | --------------------------- |
| `queued` / `processing`                                                     | kept; removed only if abandoned past 48 h | sweep (abandonment)         |
| `done` / `needs_attention`                                                  | deleted once the job completes            | pipeline; sweep as backstop |
| `failed`                                                                    | kept 7 d (the retry window), then removed | sweep                       |
| `dismissed`                                                                 | removed                                   | sweep                       |
| no owning row (crash between `store()` and `createJob`)                     | removed after a 1 h grace                 | sweep                       |
| The **7-day failed window defines retryability**: while a photo exists, a   |
| `failed` job can be retried (`POST /import-jobs/:id/retry`); once the sweep |
| clears `photoRef`, retry returns `409` ("This import has no photo to        |
| re-process"). See [Import Jobs API](/import-jobs-api.md).                   |

A `queued`/`processing` run is abandoned only after
`PHOTO_SWEEP_STUCK_JOB_MAX_AGE_MS` (48 h) with **no queue or worker activity**.
The clock is anchored on `ImportJob.enqueuedAt` — stamped when a row is created,
when `retryJob` resets it to `queued`, and when `markProcessing` starts the
worker — not on `createdAt`. A job retried inside the 7-day failed window
therefore gets a fresh 48 h and is never mistaken for abandoned; only legacy
rows without a stamp fall back to `createdAt`.

# Sweep

`PhotoSweepService` runs on a Nest `@Interval` (one pass per hour) and is a
backstop, not the primary deleter. Each pass is **file-driven** — it enumerates
`IMPORT_PHOTOS_DIR` rather than the table — because it must also catch files
with no owning row. For each file it resolves the newest `import_jobs` row by
`photoRef` (one query per batch, no N+1) and applies the pure policy
`decidePhotoSweep`.

| Input (per file)                                                                                  | Decision                             | Action                         |
| ------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------ |
| no owner, file age < `PHOTO_SWEEP_ORPHAN_GRACE_MS`                                                | `keep` / `orphan_within_grace`       | none                           |
| no owner, file age ≥ `PHOTO_SWEEP_ORPHAN_GRACE_MS`                                                | `delete` / `orphan_no_job`           | delete file                    |
| owner `done` / `needs_attention` / `dismissed`                                                    | `delete` / `terminal_photo_leftover` | release row, delete file       |
| owner `failed`, age since completion < `PHOTO_SWEEP_FAILED_RETENTION_MS`                          | `keep` / `failed_retryable`          | none                           |
| owner `failed`, age ≥ `PHOTO_SWEEP_FAILED_RETENTION_MS`                                           | `delete` / `failed_past_retention`   | release row, delete file       |
| owner `queued` / `processing`, idle < `PHOTO_SWEEP_STUCK_JOB_MAX_AGE_MS` since last enqueue/start | `keep` / `in_flight`                 | none                           |
| owner `queued` / `processing`, idle ≥ `PHOTO_SWEEP_STUCK_JOB_MAX_AGE_MS` since last enqueue/start | `delete` / `abandoned_non_terminal`  | fail row, release, delete file |
| owner unknown status                                                                              | `keep` / `unknown_status`            | none                           |

Before deleting a file with an owner, the sweep performs a **guarded release**
(`releaseSweptPhoto`): an `updateMany` keyed on `(id, photoRef, status)`. It
clears `photoRef` and, for an abandoned non-terminal job, sets `status =
failed`, `errorMessage = PHOTO_SWEEP_ABANDONED_REASON`, and `completedAt`. If
the guarded write matches no row the row moved on (for example the user retried
it), so the sweep leaves the file for the normal path. This closes the race with
`retryJob`, which itself only resets a row whose `photoRef` is still non-null:
whichever write lands first wins, and the loser skips the file delete. Deletion
is idempotent (a missing file is a no-op), a failed delete is logged and retried
next pass, and the whole pass is wrapped so a database or filesystem error is
logged, never rethrown.

# Constants

Compile-time constants, deliberately not environment variables — the same
convention as `SESSION_CLEANUP_INTERVAL_MS` (`auth.config.ts`):

| Constant                           | Value | Meaning                                         |
| ---------------------------------- | ----- | ----------------------------------------------- |
| `PHOTO_SWEEP_INTERVAL_MS`          | 1 h   | Sweep cadence                                   |
| `PHOTO_SWEEP_BATCH_SIZE`           | 500   | Files examined per pass (oldest first)          |
| `PHOTO_SWEEP_ORPHAN_GRACE_MS`      | 1 h   | Grace before a no-row file is removed           |
| `PHOTO_SWEEP_FAILED_RETENTION_MS`  | 7 d   | How long a `failed` photo stays retryable       |
| `PHOTO_SWEEP_STUCK_JOB_MAX_AGE_MS` | 48 h  | Abandonment threshold for `queued`/`processing` |

`PHOTO_SWEEP_ABANDONED_REASON` is the `errorMessage` recorded when the sweep
fails an abandoned job.

# Guarantees (acceptance)

- **While a job is `queued`/active/`failed`-retryable, the photo exists.** The
  sweep keeps `queued`/`processing` for 48 h after the last enqueue/start and
  `failed` for 7 d after completion; only the pipeline's own delete can remove it
  earlier. A user retry does **not** remove the photo — it re-anchors the run
  (via `enqueuedAt`) so the sweep leaves the file for the new attempt.
- **Once a job completes (`done`/`needs_attention`), the photo is gone.** The
  pipeline deletes it at completion; the sweep removes any leftover.
- **A permanently `failed` photo is cleaned up, not kept forever.** After 7 d
  the sweep clears `photoRef` and deletes the file.
- **No endpoint serves processed photos as a gallery.** There is no static
  mount, no `sendFile`/`StreamableFile`, and no gallery route; plausible URLs
  return `404` (regression-tested).
- **The lifecycle matches decision #4 and ADR-002.** A photo is never deleted
  at first save, only once the job is no longer going to run.

# Out of scope

- Pruning `import_jobs` / `unrecognized_items` rows — import history has
  indefinite retention (see [Import Jobs API](/import-jobs-api.md)).
- Thumbnails or a photo gallery — deliberately not built.
- HEIC and other formats — only JPEG/PNG/WebP are accepted.
- A manual admin sweep endpoint.
- Clearing a dangling `photoRef` on a terminal row whose file is already gone
  (retry is unaffected; only `failed` can retry and the sweep is the only
  `failed` deletor).
