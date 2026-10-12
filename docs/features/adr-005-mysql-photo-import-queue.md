---
type: Decision
title: ADR-005 — MySQL-backed photo-import queue (supersedes ADR-002)
description: The `import_jobs` table is the single photo-import queue; an in-process worker claims rows with `FOR UPDATE SKIP LOCKED`, so Redis and BullMQ are removed.
tags: [adr, import, queue, mysql]
status: stable
generated: { by: opencode/home-model, at: 2026-10-12T16:20:51Z }
---

# Status

Accepted. Supersedes **ADR-002** (photo-import queue on BullMQ + Redis).
ADR-002 was never stored in this repository; it is referenced in code and docs
only, so this decision records the replacement.

# Context

Photo import needs a durable queue with exactly one unit of work — the photo —
and the project is a **single-user, single-instance** app:

- there is **one** queue, processed with **concurrency 1**. Sequential processing
  is the design, not a tuning knob: IGDB allows 4 req/s and MobyGames 1 req/s, so
  parallel photos would exceed the upstream limits by construction.
- the worker must see the **same local photo directory** as the upload request
  (`IMPORT_PHOTOS_DIR`), so it cannot be a separate host or process.
- the data is already durable in **MySQL**: `import_jobs.status`,
  `recognized_items`, the `vision_completed_at` marker, the `recognized_items`
  `pending` claim that makes each item importable exactly once, and the
  `import_queue_state` pause row. The queue only needs to wake a worker and
  count attempts.
- the workload is tiny (a few photos at a time, at most a few hundred jobs).
  Running and operating a second datastore (Redis) for it is disproportionate.

The queue's own history lives nowhere else: ADR-002 states the queue is a
mechanism, not the record ("Do not treat Redis contents as an audit log"), and
[Import Jobs API](/import-jobs-api.md) documents the durable record.

# Decision

**`import_jobs` IS the photo-import queue.** No external queue service, no
BullMQ, no Redis, no ioredis.

- **Queue columns.** `import_jobs` gains `attempts` (`INTEGER NOT NULL DEFAULT 0`),
  `next_run_at` (`DATETIME(3) NULL`) and `lease_until` (`DATETIME(3) NULL`), with
  the index `(status, next_run_at)`. A row is **runnable** when
  `status = 'queued' AND next_run_at <= now`; a NULL `next_run_at` is never
  runnable (rows created without `enqueue` stay inert).
- **In-process worker.** `PhotoImportWorker` runs inside the API process and
  polls `import_jobs` every **1 s** with concurrency **1**. A single transaction
  claims the oldest due row with
  `SELECT id … WHERE status = 'queued' AND next_run_at <= now ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
  marking it `processing`, incrementing `attempts` and setting `lease_until`.
- **Wake on enqueue/resume.** `PhotoImportQueue.wake()` signals the in-process
  worker directly after an upload (`createJob({ enqueue: true })`), a user retry
  and a queue resume, so a new job starts without waiting for the next poll.
- **Lease.** `IMPORT_JOB_LEASE_MS = 480 s` must exceed
  `IMPORT_JOB_TIMEOUT_MS = 420 s`, so a live attempt never looks stalled. There
  is no renewal.
- **Stall recovery.** On boot and every `IMPORT_STALL_CHECK_INTERVAL_MS = 30 s`,
  the worker reclaims `processing` rows whose lease expired: a row with attempts
  left is re-queued with the backoff delay, and one whose budget is exhausted is
  marked `failed`. A stalled attempt **consumes an attempt**.
- **Retry.** `IMPORT_MAX_ATTEMPTS = 3` total attempts with exponential backoff
  (`retryDelayMs`, base `IMPORT_RETRY_BACKOFF_MS = 5000` → 5 s, then 10 s).
  `PermanentImportError` (the replacement for BullMQ's `UnrecoverableError`)
  fails a row immediately.
- **Pause.** `import_queue_state.paused` is the **single source of truth**: the
  worker claims nothing while paused, and `resume()` wakes it. A missing row
  means not paused.
- **Concurrency stays 1.** `PHOTO_IMPORT_CONCURRENCY` remains pinned to 1;
  raising it requires a new ADR superseding this one.
- **Health.** `GET /health/queue` reports `{ status, queue, concurrency, workerReady, counts }`,
  with `counts` from one `GROUP BY status` keyed
  `queued | processing | done | needs_attention | failed | dismissed`.
- **Removed.** The `bullmq`, `@nestjs/bullmq` and `ioredis` dependencies, the
  `REDIS_*` env vars, the Redis service in `docker-compose.yml` and CI, and the
  `bull_job_id` column. Migration
  `20261012150000_import_jobs_mysql_queue` drops the column, adds the queue
  columns and backfills every `queued`/`processing` row to runnable now.

# Consequences

- **No Redis to run or operate.** `docker compose up -d mysql` is enough;
  `REDIS_HOST`, `REDIS_PORT`, `REDIS_QUEUE_PREFIX` and `REDIS_URL` are gone.
- **Recovery after a crash takes up to the lease** (480 s, plus up to the 30 s
  stall-check interval) — the same window as BullMQ's lock before, so it is not
  a regression. Lease heartbeats or per-boot ownership are out of scope.
- **Multi-worker is possible later** (the `SKIP LOCKED` claim is a real
  distributed lock), but is blocked today by the shared local photo directory —
  a second worker on another host could not read the photo. Concurrency 1 is
  therefore a deployment constraint, not only a rate-limit one.
- **CLIs that boot `AppModule`** (`db:seed`, `db:clear-dev`, `covers:redownload`,
  `user:*`) run the worker for the duration of the command and may claim a due
  job, exactly as they started the BullMQ worker before. The timers are
  `unref()`'d and shutdown stops the worker, so a CLI never hangs.
- **A stall now consumes an attempt** and, once the budget is exhausted, marks
  the row `failed` with its counters. Before, `maxStalledCount = 2` was a
  separate budget and a stall-failed BullMQ job left the DB row stuck in
  `processing`.
- **During backoff the durable row is `queued`.** Before, the row was
  `processing` while the merged API status showed `queued`; the API-visible
  status is unchanged.
- **The read API no longer reports queue internals.** `GET /import-jobs*` drops
  `queueState` and `bullJobId`; the upload response's `jobId` is now
  `String(id)`. See [Import Jobs API](/import-jobs-api.md) and
  [Import Photo Upload API](/import-upload-api.md).

# Alternatives

- **Keep BullMQ + Redis (ADR-002).** Rejected: a second datastore to run, back
  up and debug, for a tiny single-instance workload whose durability already
  lives in MySQL.
- **A generic database-backed queue library.** Rejected: no maintained library
  does this for Node + MySQL, and the required semantics (claim, lease, retry,
  stall recovery, pause) are a handful of guarded queries over one table.
- **Advisory locks or a `SELECT … FOR UPDATE` without `SKIP LOCKED`.** Rejected:
  `SKIP LOCKED` is what makes a concurrent claim safe without serialising the
  pollers, and it keeps a later multi-worker step open.
