---
type: Feature
title: Import Progress UI
description: The authenticated /import/progress/[batchId] view — aggregate X-of-Y progress, per-photo status and counts, a needs-attention review section (flagged-item review, inline manual add, retry, dismiss), live polling with a throttled heartbeat while the queue is paused, and a queue-paused banner with resume.
tags: [web, import, ui]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-08T21:54:58Z }
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
3. **What needs a decision?** — a **Needs attention** section listing every
   review-flagged or failed photo, with its flagged items, an inline manual add,
   and retry/dismiss actions.
4. **Why did everything stop?** — a "Queue paused" banner naming the integration
   to fix, with a resume action.

# Routes

| Route                        | Renders                                                                                                                                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/import/progress/[batchId]` | `(app)/import/progress/[batchId]/page.tsx` (server, `force-dynamic`, `requireUser`) → `ImportProgressView` (client). Calls `getImportBatch` (404/400 → `notFound()`), `getImportJobsForBatch`, and `getPlatforms` in sequence, then hands the snapshot to the client. |
| `/import`                    | `PhotoImportForm` persists the last successful `batchId` under `localStorage` key `gameshelf.lastImportBatchId` and shows a **Check your most recent import** link back to the progress view.                                                                         |

The pure view helpers live in `apps/web/src/lib/import/progress.ts` (`statusView`,
`jobCounts`, `batchCounts`, `sortPhotos`, `plural`, `pauseCopy`,
`photoCountsLine`, `recognitionLine`, `needsReview`, `matchPlatformId` — no side
effects, so a future test runner can cover them). The client components are
`apps/web/src/components/import-progress-view.tsx` (page shell and polling) and
`apps/web/src/components/import-attention-review.tsx` (the needs-attention
section).

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

Rows carry a tone so a flagged photo is visually distinct in the timeline as
well as in the review section: a `needsAttention` row uses the warning tone
(`border-accent/40 bg-accent-soft`), a `failed` row the danger tone
(`border-danger/40 bg-danger/10`), and every other row the neutral surface tone
(`border-edge bg-surface-2`).

# Needs attention review

After the counts grid and before the `Photos` timeline, `ImportAttentionReview`
renders a **Needs attention** section. A photo is in the section when
`needsReview(photo)` is true — that is, the backend `needsAttention` boolean is
`true` **or** `status === 'failed'` (a failure is action-required even though the
API does not set `needsAttention` for it). When no photo qualifies the section
is not rendered at all.

**`needsAttention` is the single source of truth.** It is the backend computed
field (`status === 'needs_attention'`), derived from the flag rule
`recognizedCount === 0 || (declaredCount !== null && recognizedCount !==
declaredCount) || unrecognizedCount > 0`. The client adds **no** rule keyed on
`declaredCount`; `declaredCountMismatch` is `false` whenever `declaredCount` is
`null`, so a photo with no declared count and some recognized games is
`done`/`needsAttention: false` and never appears here. A no-declared photo that
recognizes **nothing** is flagged by the backend (anti-silent-failure) and is
shown as-is — that is a backend contract, not a client rule. The
declared-vs-recognized line with a **Count mismatch** chip is shown for
non-failed cards.

Each card shows:

- the photo number and its `statusView` label/tone;
- the counts line (`photoCountsLine`) and, for non-failed cards, the
  declared-vs-recognized line (`recognitionLine`) — danger-coloured with a
  **Count mismatch** chip on `declaredCountMismatch`; for failed cards the
  `errorMessage`;
- **Flagged items** (only when `unrecognizedCount > 0`): the card fetches
  `GET /import-jobs/:id/unrecognized` on mount (aborting on unmount/change; a
  `401` redirects to `/login`). Each item shows its raw title plus
  `rawPlatform`/`reason` when present. An item can be **Dismissed**
  (`PATCH /import-jobs/:id/unrecognized/:itemId { dismissed: true }`, removed
  from the list locally) or opened for **Add manually**;
- **Add manually**: a disclosure that mounts the shared `ManualAddForm` inline,
  prefilled with the item's `rawTitle` and the platform resolved by
  `matchPlatformId` (case-insensitive match on platform name or slug; unknown →
  empty, the user picks). On success the created game is reported and the
  item is auto-dismissed (the manual add is treated as the review decision);
- **Retry photo** (failed cards only): `POST /import-jobs/:id/retry` (the API
  returns `409` for any non-`failed` status, so the control is not shown
  elsewhere), followed by a snapshot refetch. A note states that retry re-runs
  only the games not yet saved and never duplicates games already in the
  catalog (backend guarantee: pending-only re-run + vision marker + guarded
  `updateMany`);
- **Dismiss photo** (`needs_attention`/`failed` cards): a two-step inline
  `role="alertdialog"` confirm (Cancel focused on open, Escape cancels) calling
  `PATCH /import-jobs/:id { status: 'dismissed' }`, then a snapshot refetch.
  Dismissal is sticky — the backend refuses to move a terminal row and
  `needsAttention` becomes `false`, so the card leaves the section and stays
  out after a reload.

The old standalone "Photos that failed" list has been absorbed: failed photos
now appear only in the timeline and in this section.

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
- The aggregate "X of Y photos processed" line is the **only** polled
  `aria-live` region (`role="status"`, `aria-live="polite"`); the footer
  "Reconnecting…" line and per-photo rows are not live, so a noisy list never
  announces on every poll. The needs-attention section adds its own action
  feedback: `role="alert"` for load/action errors and `role="status"
aria-live="polite"` for the post-save and loading messages.
- The paused banner is `role="alert"`; the resume error is `role="alert"`.
- The dismiss-photo confirmation is a `role="alertdialog"` with labelled and
  described ids, focuses its Cancel button (least-destructive) on open, and
  closes on Escape; the flagged-item **Add manually** disclosure is a real
  button with `aria-expanded`.
- Status is conveyed by text as well as the colour dot; the dot is
  `aria-hidden`. The busy dot uses `animate-pulse motion-reduce:animate-none`.
- All controls are real links/buttons with focus-visible rings; the counts grid
  is a `<dl>`.

# Backend contract

- Batch progress and the job list: [Import Jobs API](/import-jobs-api.md)
  (`GET /import-jobs/batches/:batchId`, `GET /import-jobs?batchId=…`).
- Needs-attention review reuses existing endpoints: `GET
/import-jobs/:id/unrecognized`, `PATCH /import-jobs/:id` (`{ status:
'dismissed' }`), `PATCH /import-jobs/:id/unrecognized/:itemId` (`{ dismissed:
true }`), and `POST /import-jobs/:id/retry` — see [Import Jobs
  API](/import-jobs-api.md).
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
   reason, and the same photo in the **Needs attention** section (the old
   standalone "Photos that failed" list is gone).
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

## Deterministic seed (no LLM/IGDB needed)

A seeded batch exercises the review section without a provider. After `npm run
dev` and `npm run user:create`:

```bash
docker compose exec -T mysql mysql -ugameshelf -pgameshelf gameshelf <<'SQL'
INSERT INTO platforms (name, slug) VALUES ('Nintendo Switch', 'nintendo-switch')
  ON DUPLICATE KEY UPDATE name = name;

INSERT INTO import_jobs (status, declared_count, recognized_count, imported_count, unrecognized_count, batch_id, created_at, completed_at)
VALUES ('needs_attention', 5, 3, 2, 2, 'qa-attention', NOW(), NOW());
SET @job = LAST_INSERT_ID();
INSERT INTO unrecognized_items (import_job_id, raw_title, raw_platform, reason) VALUES
  (@job, 'PlayStaton 5', 'PS4', 'No game matched the title in any source — IGDB: no match'),
  (@job, 'Zorblax Chronicles 9000', NULL, 'No game matched the title in any source');

INSERT INTO import_jobs (status, declared_count, recognized_count, imported_count, unrecognized_count, batch_id, created_at, completed_at)
VALUES ('done', NULL, 2, 2, 0, 'qa-attention', NOW(), NOW());

INSERT INTO import_jobs (status, error_message, declared_count, recognized_count, imported_count, unrecognized_count, photo_ref, batch_id, created_at, completed_at)
VALUES ('failed', 'LLM request timed out', 4, 2, 2, 0, 'qa-missing.png', 'qa-attention', NOW(), NOW());
SQL
```

Open `http://localhost:3000/import/progress/qa-attention` and verify:

1. **Distinct + comparison.** The mismatch photo is a warning-bordered **Needs
   attention** card; its line reads `You declared 5; recognized 3.` in red with
   a **Count mismatch** chip; it also has a warning-toned row in the `Photos`
   timeline.
2. **Unrecognized list.** The card lists `PlayStaton 5` (with `PS4` and the
   reason) and `Zorblax Chronicles 9000` — raw titles, not imported.
3. **Manual add.** Click **Add manually** on `PlayStaton 5`; the title is
   prefilled, the platform is empty (PS4 not in the seeded list). Pick
   `Nintendo Switch`, **Add to catalog**. Expect a status
   `Added “…”. This flagged item is now marked as reviewed.` and the item
   disappears. `GET /games` shows one new manual game.
4. **Retry.** The failed card shows **Retry photo** plus the no-duplicate note.
   Click it; Network shows `POST /api/import-jobs/<id>/retry` → **202**; the
   card/row leaves the attention list into the queue (it fails again shortly —
   expected with no provider/real photo).
5. **Dismiss photo.** On the mismatch card click **Dismiss photo** → confirm.
   Network `PATCH /api/import-jobs/<id>` → 200; the card leaves the section and
   the timeline row shows `Dismissed`. Reload: still `Dismissed` (sticky).
6. **No declared count.** The `done` photo appears only as `Completed` in the
   timeline, never in **Needs attention**.
7. **No console/CSP errors.**

# Out of scope

- Blocking uploads while the queue is paused.
- A frontend unit/integration test runner (the pure helpers are ready for one).
- External database search inside the review form (the inline `ManualAddForm` is
  typed-only, like `/games/new`).
- Un-dismissing a photo or item — dismissal is one-way in the backend.
- A compact variant of the inline manual-add widget (the full form is mounted
  inline, one item at a time).
- Internationalization.
