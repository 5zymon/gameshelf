---
type: Feature
title: Queue Pause on Configuration Error
description: A rejected/absent LLM, IGDB, or MobyGames credential fails the current photo, durably pauses the single photo-import queue, surfaces the pause on batch progress, and resumes explicitly or when the LLM key is saved.
tags: [import, worker, mysql-queue, igdb, mobygames, vision, reliability]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-07T07:30:00Z }
---

# Overview

A configuration error is not a data error. When the LLM provider rejects the
API key (vision HTTP 401/403, or no key at all) or IGDB rejects/omits its
credentials, re-trying the same broken configuration just fails every remaining
photo one by one and produces a wall of `failed` jobs. Ticket 3.10 makes that
configuration error **stop the queue at the first photo**:

1. the **current** photo fails (with the config reason stored on the job);
2. a **durable pause reason** is written to `import_queue_state`;
3. the single photo-import queue is **paused** (the worker claims nothing while
   `import_queue_state.paused` is true), so no further photo starts;
4. the pause and its reason are exposed on the batch-progress API;
5. the operator can **resume** explicitly (`POST /import-jobs/resume`) or by
   saving an LLM key (`PUT /settings/llm`).

A restart never duplicates already-saved games (existing pipeline idempotency)
and never auto-resumes into a still-broken configuration (there is **no**
resume on boot).

# Classification seam

`apps/api/src/queue/photo-import.failure.ts` exports the single classifier both
failure paths share:

- `ConfigurationImportError` — thrown by the pipeline when a catalog resolution
  is `config_error`; carries `source: 'igdb' | 'llm' | 'mobygames'`.
- `configErrorSource(error): 'llm' | 'igdb' | 'mobygames' | null` — returns the
  integration to fix for a `ConfigurationImportError`, `IgdbConfigError`,
  `MobygamesConfigError`, `VisionUnavailableError`, or an `unauthorized`
  `VisionProviderError`; `null` for everything else.

`isRetryableImportError` consults `configErrorSource` first, so a configuration
error is **never** retryable, and `photoImportFailureReason` returns the safe
config message for it.

IGDB makes the distinction structural:

- `IgdbConfigError extends IgdbError` (still `retryable === false` and
  `instanceof IgdbError`, so existing assertions keep passing).
- `igdbErrorFromStatus(401 | 403)` returns `IgdbConfigError`;
  `IgdbClient.requiredEnv` throws it when `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`
  is missing (a deliberately broader classification: an unconfigured IGDB would
  otherwise fail every photo one by one).
- `IgdbGameCatalogResolver.errorResolution` maps it to
  `{ kind: 'config_error', source: 'igdb', reason }`, and
  `ChainedGameCatalogResolver.resolve` short-circuits `config_error` exactly
  like `transient` (the fallback source is never consulted). `resolveBatch`
  reuses the same mapping.

MobyGames follows the same split: `MobygamesConfigError extends MobygamesError`
(`401`/`403` → config error), the resolver maps it to
`{ kind: 'config_error', source: 'mobygames' }`, and the chain short-circuits it
identically. Crucially, an **absent** `MOBYGAMES_API_KEY` is _not_ a config
error: the fallback source is not registered at all, the chain stays `[igdb]`,
and a title IGDB misses is simply `unrecognized` — no pause. Only a _configured
but rejected_ key pauses the queue, which is why `.env.example` keeps the key
commented. See [MobyGames Fallback](/mobygames-fallback.md).

# Pipeline behaviour

In `PhotoImportPipelineService`:

- `resolveBatch` throws `ConfigurationImportError` when a resolution is
  `config_error`, **before** committing the batch. The still-pending titles are
  re-resolved on a later retry and are never duplicated.
- The `run` catch classifies with `configErrorSource(error)`; on a config error
  it marks the current job `failed`, calls `pauseForConfigErrorSafely` (a
  best-effort pause that never masks the original error), and throws
  `PermanentImportError` so the worker fails the row immediately and no further
  attempt is scheduled.
- Ordinary permanent failures (`bad_response`, malformed query, …) keep their
  existing behaviour and never pause the queue.

# Pause state and `QueueControlService`

`QueueControlService` (global, exported by `QueueModule`) owns the operational
pause:

| Method                           | Behaviour                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pauseForConfig(source, reason)` | Upsert the singleton `import_queue_state` row (`id = 1`, `paused`, `reason`, `source`, `pausedAt`). No queue call — the worker reads the row before every claim. |
| `resume()`                       | Clear the row (`paused = false`, `reason`/`source`/`pausedAt` null) and wake the worker. Idempotent.                                                             |
| `resumeIfPausedBy(source)`       | Resume only when currently paused **for that source**; returns whether it did.                                                                                   |
| `getState()`                     | Read the row: `paused`, `reason`, `source`, `pausedAt`; a missing or running row reports not paused.                                                             |
| `isPaused()`                     | `import_queue_state.paused` (default `false`). The worker checks it before every claim.                                                                          |

MySQL `import_queue_state` is the **single source of truth** (ADR-005): both
whether the queue is paused and why come from it, so the state survives a restart
and there is no separate queue flag to fall back to or desync. The queue is not
auto-resumed on boot — a still-broken configuration would immediately re-fail.

# API surface

`ImportBatchProgressModel` (the `GET /import-jobs/batches/:batchId` response)
gains:

```json
{
  "paused": true,
  "pauseReason": "IGDB rejected the credentials",
  "pauseSource": "igdb"
}
```

`pauseReason` falls back to the default
`Photo import is paused until the configuration is fixed` when the row says
paused but records no reason.

`POST /import-jobs/resume` returns `ImportQueueStateModel`
(`{ paused, reason, source, pausedAt }`) and is idempotent: resuming a running
queue is a `200` no-op that clears the stored reason. It requires the normal
session auth (401 otherwise). See [Import Jobs API](/import-jobs-api.md).

`PUT /settings/llm` resumes a queue paused by an `llm` config error **only when
the saved settings now report `keyPresent`**. A resume failure is logged and
never fails the settings write. See [LLM Settings API](/llm-settings-api.md).

# Restart and idempotency

- **No duplicate games.** The existing pipeline guarantees are unchanged:
  `vision_completed_at` prevents a second vision call, only `pending`
  recognized items are re-resolved, and the guarded `updateMany({ status:
'pending' })` claim rolls a batch back instead of duplicating a `Game`. A
  config error is thrown **before** `commitImportBatch`, so nothing from the
  failing batch is committed.
- **No auto-resume on boot.** Restarting the API keeps the pause — it lives in
  the durable `import_queue_state` row, and boot neither resets it nor replays
  anything. The operator resumes explicitly
  (`POST /import-jobs/resume`) after fixing an IGDB env issue, or the queue
  resumes when a key is saved (`PUT /settings/llm`, source `llm`).

# Out of scope

- Blocking `POST /import/upload` while the queue is paused.
- Surfacing the pause on `/health/queue`.
