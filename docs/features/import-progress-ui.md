---
type: Feature
title: Import Progress UI
description: The authenticated /import/progress/[batchId] view — aggregate X-of-Y progress, per-photo status and counts, a failure list, live polling with a throttled heartbeat while the queue is paused, and a queue-paused banner with resume.
tags: [web, import, ui]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-08T04:23:37Z }
---

# Overview

`/import/progress/[batchId]` is the reload-safe destination of a started photo
import. The server renders the first paint from the batch aggregate and the
per-photo rows, and the client keeps them live until the batch finishes. A user
can close the tab, come back, or hard-reload and still see the true state,
because every fact on the page is server-backed.

The view answers four questions at a glance:

1. **How far along is the batch?** — an X-of-Y progress bar and a counts grid.
2. **What is each photo doing?** — one row per photo with a status, counts, and a
   declared-vs-recognized line.
3. **What failed, and why?** — the failure reason inline and in a dedicated
   "Photos that failed" list.
4. **Why did everything stop?** — a "Queue paused" banner naming the integration
   to fix, with a resume action.

# Routes

| Route                        | Renders                                                                                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/import/progress/[batchId]` | `(app)/import/progress/[batchId]/page.tsx` (server, `force-dynamic`, `requireUser`) → `ImportProgressView` (client). Calls `getImportBatch` (404/400 → `notFound()`) and `getImportJobsForBatch` in sequence, then hands the snapshot to the client. |
| `/import`                    | `PhotoImportForm` persists the last successful `batchId` under `localStorage` key `gameshelf.lastImportBatchId` and shows a **Check your most recent import** link back to the progress view.                                                        |

The pure view helpers live in `apps/web/src/lib/import/progress.ts` (no side
effects, so a future test runner can cover them). The client component is
`apps/web/src/components/import-progress-view.tsx`.

# Polling

| Condition                                  | Interval | Source                                  |
| ------------------------------------------ | -------- | --------------------------------------- |
| Running (`allCompleted` false, not paused) | 2 s      | `POLL_RUNNING_MS`                       |
| Paused (`paused` true, not completed)      | 15 s     | `POLL_PAUSED_MS`                        |
| Completed (`allCompleted` true)            | —        | polling stops; the effect returns early |

- A **recursive `setTimeout`** (not `setInterval`) schedules the next tick only
  after the previous tick settles, so ticks cannot pile up on a slow network.
- Each tick fetches `GET /import-jobs/batches/:batchId` and
  `GET /import-jobs?batchId=…&limit=100` in one `Promise.all`, then replaces the
  in-memory snapshot. On success it clears any "reconnecting" state.
- **Errors are non-destructive**: a network failure keeps the last good snapshot
  and sets the footer "Reconnecting…" line; polling continues. A `401` redirects
  to `/login` and stops.
- **Cleanup aborts in flight**: the effect owns one `AbortController`, and its
  cleanup aborts the controller and clears the pending timer. The effect re-runs
  when `batchId`, `allCompleted`, or `paused` changes, so a pause/resume is
  reflected on the next tick.
- **Reload/navigation safety**: polling is purely additive over the server
  render. An unmounted or reloaded page loses nothing — the next server render
  returns the same authoritative snapshot.
- **Paused tab regain**: while paused (and not completed), a `window` `focus`
  and `document` `visibilitychange` listener refetches once, so a user who fixes
  the configuration in another tab sees it without waiting for the heartbeat.

# Per-photo status and counts

`statusView(status)` maps every `ImportJobStatus` to a label, a tone token and a
`busy` flag (the row dot pulses while `busy`):

| Status            | Label                    | Tone    | Busy |
| ----------------- | ------------------------ | ------- | ---- |
| `queued`          | Queued                   | muted   | no   |
| `processing`      | Reading                  | active  | yes  |
| `done`            | Completed                | success | no   |
| `needs_attention` | Completed · needs review | warning | no   |
| `failed`          | Failed                   | danger  | no   |
| `dismissed`       | Dismissed                | muted   | no   |

Rows are ordered by ascending job `id` and labelled **Photo 1, Photo 2 …**. The
API stores no original filename and `photoRef` is opaque internal data, so the
stable id order is the only identity shown — the browsed filename is deliberately
never surfaced.

Counts come from `jobCounts(job)` / `batchCounts(items, progress)`:

- **Added** = `importedCount` — games committed to the catalog.
- **Needs review** = `unrecognizedCount` — recognized but unresolved titles.
- **Failed** = the count of photos whose `status === 'failed'`; failure is a
  photo-level outcome, not a per-title counter.
- **Still to process** = the aggregate `pendingCount` (photos, not the summed
  per-job `pendingCount`).

> **There is no distinct "skip" counter.** A photo either adds games, flags
> titles for review, or fails whole. Anything that looks like "skipped" is one
> of those three; do not invent a fourth bucket.

Each terminal row also shows a **recognized** line: with no declared count it
reads "Recognized N games."; with a declared count it reads "You declared D;
recognized N." and turns danger-coloured when `declaredCountMismatch` is set.

# Failure list

A failed photo shows its `errorMessage` inline in the row **and** again in a
dedicated "Photos that failed" section, so failures are scannable without
reading every row. A row with a null message falls back to a generic sentence.

# Queue-paused banner

When `progress.paused` is true, a `role="alert"` banner renders:

- the heading **Queue paused**;
- `progress.pauseReason`, or `pauseCopy(source).reasonFallback` when the API
  supplies no reason;
- a fix hint keyed by `pauseSource` (`llm` → check the key in Settings and links
  to `/settings`; `igdb` → fix the credentials server-side; anything else →
  generic);
- a **Resume queue** button calling `POST /import-jobs/resume`, then refetching
  both endpoints; a failure surfaces `resumeError`.

`paused` is **not** terminal: paused photos stay `queued`, so `allCompleted`
stays false and the page keeps polling at the throttled heartbeat.

# Accessibility

- The aggregate progress bar is `role="progressbar"` with
  `aria-valuenow/min/max` and an accessible label naming X and Y.
- The aggregate "X of Y photos processed" line is the **only** `aria-live`
  region (`role="status"`, `aria-live="polite"`); the footer "Reconnecting…"
  line and per-photo rows are not live, so a noisy list never announces on every
  poll.
- The paused banner is `role="alert"`; the resume error is `role="alert"`.
- Status is conveyed by text as well as the colour dot; the dot is
  `aria-hidden`. The busy dot uses `animate-pulse motion-reduce:animate-none`.
- All controls are real links/buttons with focus-visible rings; the counts grid
  is a `<dl>`.

# Backend contract

- Batch progress and the job list: [Import Jobs API](/import-jobs-api.md)
  (`GET /import-jobs/batches/:batchId`, `GET /import-jobs?batchId=…`).
- `paused` / `pauseReason` / `pauseSource` and `POST /import-jobs/resume`:
  [Queue Pause on Configuration Error](/queue-pause-on-config-error.md).

No API or contract change was required for this ticket.

# Manual acceptance script

Setup:

```bash
cp .env.example .env      # SESSION_SECRET (>=32 chars), DB, GEMINI_API_KEY
docker compose up -d mysql redis
npm run db:deploy
npm run dev               # API :3001, web :3000
```

1. **Start an import.** On `/import`, upload several photos (a mix that will
   match and one that will not). Expect navigation to
   `/import/progress/<batchId>`.
2. **First paint.** The server render shows the heading, the progress bar, the
   counts grid, and one row per photo **before** hydration.
3. **Live counts.** Watch the bar and the "X of Y photos processed" line advance
   without a manual reload; rows move Queued → Reading → Completed.
4. **Per-photo detail.** A completed row shows "Added N games." and the
   recognized/declared line. Now do the same upload with an over-declared count
   and confirm the mismatch line turns red.
5. **Failure.** Upload a corrupt/unreadable photo. Expect a `Failed` row with its
   reason, and the same photo in "Photos that failed".
6. **Reload safety.** Reload the page mid-import; expect the same state, and a
   second tab opened on the URL to converge.
7. **Leave and return.** Navigate to `/`, wait, then use **Check your most recent
   import** on `/import` to return; expect current progress.
8. **Completion.** When every photo is terminal, the heading becomes "Import
   finished" and polling stops (Network tab goes quiet).
9. **Paused banner.** With a bad `GEMINI_API_KEY` (or reject IGDB), start an
   import. Expect the "Queue paused" banner with the reason and a fix hint; the
   heartbeat is 15 s. Fix the configuration, press **Resume queue**, and confirm
   the import continues.
10. **Paused focus refetch.** While paused, focus another window and return;
    expect one refetch (not a 2 s storm).
11. **No CSP violations.** The console shows no CSP errors from the view.

# Out of scope

- Reviewing/acting on flagged `UnrecognizedItem`s (dismiss, retry, manual match)
  — a separate flagged-item review ticket.
- Blocking uploads while the queue is paused.
- A frontend unit/integration test runner (the pure helpers are ready for one).
