---
type: Feature
title: Import Photo Upload API
description: POST /import/upload — multi-photo multipart upload, optional per-photo declared counts, ephemeral storage, background queuing, and a batch id for aggregate progress.
tags: [api, import, upload]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-06T13:30:00Z }
---

# Overview

`POST /import/upload` is how photos enter the import pipeline. One request
accepts many photos, optionally with a per-photo declared item count, and
returns immediately: the request only validates, writes the photos to
ephemeral storage, records one `queued` import run per photo, and makes each row
runnable and wakes the in-process worker. No recognition / LLM / external work
happens inline — that is the worker's job (ADR-005), and the API never blocks on
it.

The endpoint owns the _creation_ half of the import lifecycle; the durable
records it produces are read back through the
[Import Jobs API](/import-jobs-api.md).

# Endpoint contract

| Method | Path             | Purpose                           | Success                           | Errors              |
| ------ | ---------------- | --------------------------------- | --------------------------------- | ------------------- |
| `POST` | `/import/upload` | Upload photos for import (queued) | `202` `StartImportUploadResponse` | `400`, `401`, `503` |

`multipart/form-data`, authenticated by the global `SessionGuard` (a session
cookie is required; an unauthenticated request is `401`).

## Fields

| Field            | Required | Rules                                                                                                                                                   |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files`          | yes      | 1–50 photos, each JPEG/PNG/WebP, max 20 MB. Repeat the part once per photo.                                                                             |
| `declaredCounts` | no       | Optional per-photo item count, index-aligned with `files`. Repeat the field once per photo; an empty value leaves that photo undeclared. Omit for none. |

`declaredCounts` handling:

- Absent or empty → every photo is undeclared (the job's `declaredCount` is
  `null`).
- Fewer entries than photos → the trailing photos are undeclared (`null`).
- More entries than photos → `400`.
- Each provided entry must be an integer `1`–`1000`; anything else (including
  `0`, negative, decimal, or non-numeric) → `400`.

## Response

`202 Accepted`:

```json
{
  "batchId": "c1f0a4e2-...-9b3d",
  "jobs": [
    { "id": 42, "jobId": "1", "status": "queued", "declaredCount": 12 },
    { "id": 43, "jobId": "2", "status": "queued", "declaredCount": null }
  ]
}
```

`id` is the persisted `import_jobs` row (poll it via
`GET /import-jobs/:id`); `jobId` is `String(id)` — the row itself is the queue
entry (ADR-005); `status` is always
`queued` on this path. `batchId` groups every photo from this request: poll
`GET /import-jobs/batches/:batchId` for aggregate progress (X of Y) or filter
the list with `GET /import-jobs?batchId=` — see
[Import Jobs API](/import-jobs-api.md).

# What the request does, in order

1. **LLM gate.** `LlmSettingsService.isConfigured()` must be `true`: an API
   key (the encrypted `llm_settings` row or `CUSTOM_API_KEY`) **and** a base
   URL (stored in Settings) are available. If not, the API responds `503`
   _before storing or enqueuing anything_ — the pipeline cannot run without a
   model, so the upload is refused up front. See
   [LLM Settings API](/llm-settings-api.md) for the precedence rules.
2. **Validation.** File type/size/count and `declaredCounts` are checked
   (`400` on violation).
3. **Ephemeral storage.** Each photo is written to `IMPORT_PHOTOS_DIR` under a
   random UUID filename (extension derived from the mimetype).
4. **Job row.** One `import_jobs` row per photo with `status = 'queued'`,
   `photo_ref` set to the stored filename, and the request's one `batch_id`.
5. **Enqueue.** The row is created **runnable** (`next_run_at = now`,
   `attempts = 0`) and the in-process worker is woken, so it starts without
   waiting for the next poll. There is no separate queue write and no
   `bull_job_id`: the row itself is the queue entry (ADR-005). See
   [Photo Import Pipeline](/photo-import-pipeline.md).
6. **Return** the batch id and created ids immediately (`202`).

# Ephemeral storage

- Photos live in `IMPORT_PHOTOS_DIR`, defaulting to
  `<OS temp>/gameshelf-import-photos` when the variable is blank/absent.
- The API **never serves** files from this directory. There is no static
  mount and no gallery route — the directory is a hand-off buffer between the
  upload request and the worker, not user-facing storage.
- The import pipeline deletes each photo after processing completes
  ([Photo Import Pipeline](/photo-import-pipeline.md)); a backstop sweep
  ([Photo Lifecycle & Retention](/photo-lifecycle.md)) removes what is left
  behind. A photo from a failed enqueue is covered because its row is `failed`
  and the sweep applies the failed-retention window; a crash between storing a
  photo and creating its row is covered by the sweep's orphan grace period.

`ImportJob.photoRef` is an opaque internal filename (e.g.
`3f2a1c9e-....jpg`). It is present in the read models for traceability but is
not a URL and must not be served.

# Errors

| Status | When                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | No files; unsupported type; oversized file (the API remaps multer's `413` to `400`); misaligned or invalid `declaredCounts`.                                                           |
| `401`  | No valid session.                                                                                                                                                                      |
| `503`  | Game recognition is not configured (no API key or no base URL; see [LLM Settings API](/llm-settings-api.md)), or enqueueing failed. Nothing is stored/queued in the unconfigured case. |

An enqueue failure marks the just-created row `failed` and returns `503`;
photos already enqueued earlier in the same request stay queued.

# Out of scope

- **Recognition / IGDB / MobyGames matching** (ticket 3.5) — the worker does
  it; see [Photo Import Pipeline](/photo-import-pipeline.md). This endpoint only
  queues.
- **Retry** (`POST /import-jobs/:id/retry`) and **item resolution** — see
  [Import Jobs API](/import-jobs-api.md). Retry is implemented; item
  resolution is not.
- **Thumbnails / a photo gallery** — deliberately not built; storage is
  ephemeral only.
- **HEIC and other formats** — only JPEG/PNG/WebP are accepted by this
  endpoint; the web client converts HEIC to JPEG in the browser before upload,
  so HEIC never reaches the API (see
  [Photo Import Upload UI](/photo-import-upload-ui.md)).
