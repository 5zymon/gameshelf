---
type: Feature
title: Import Progress UI
description: The authenticated /import/progress/[batchId] view — aggregate X-of-Y progress, one Photos list with a per-photo state (chip, summary, why line, actions), inline flagged-title review with a compact add form, live polling with a throttled heartbeat while the queue is paused, and a queue-paused banner with resume.
tags: [web, import, ui]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-14T18:22:41Z }
---

# Overview

`/import/progress/[batchId]` is the reload-safe destination of a started photo
import. The server renders the first paint from the batch aggregate and the
per-photo rows, and the client keeps them live until the batch finishes. A user
can close the tab, come back, or hard-reload and still see the true state,
because every fact on the page is server-backed.

The view answers four questions at a glance:

1. **How far along is the batch?** — an X-of-Y progress bar and a counts grid.
2. **What is each photo doing?** — one **Photos** list with one entry per photo:
   a state chip, a plain-language summary, and the actions that photo allows.
3. **What needs a decision?** — the same list marks the photos that need one
   (failed, unmatched titles, nothing recognized, count mismatch) with an accent
   or danger bar, a "why" line, and its actions; the section summary counts them
   and links to each one.
4. **Why did everything stop?** — a "Queue paused" banner naming the integration
   to fix, with a resume action.

# Routes

| Route                        | Renders                                                                                                                                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/import/progress/[batchId]` | `(app)/import/progress/[batchId]/page.tsx` (server, `force-dynamic`, `requireUser`) → `ImportProgressView` (client). Calls `getImportBatch` (404/400 → `notFound()`), `getImportJobsForBatch`, and `getPlatforms` in sequence, then hands the snapshot to the client. |
| `/import`                    | `PhotoImportForm` persists the last successful `batchId` under `localStorage` key `gameshelf.lastImportBatchId` and shows a **Check your most recent import** link back to the progress view.                                                                         |

The pure view helpers live in `apps/web/src/lib/import/progress.ts`
(`photoState`, `needsDecision`, `canDismissPhoto`, `photoReviewCounts`,
`batchCounts`, `mismatchDirection`, `flaggedItemReason`, `isTerminalStatus`,
`sortPhotos`, `pauseCopy`, `matchPlatformId` — no side effects, covered by
`apps/web/test/import-progress.test.mjs`). The client components are
`apps/web/src/components/import-progress-view.tsx` (page shell and polling) and
`apps/web/src/components/import-photo-review.tsx` (the Photos list).

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

# Photo states

Every photo appears exactly once, in one **Photos** list. Rows are ordered by
ascending job `id` (a UUIDv7, so ascending id is upload order — ADR-006) and
labelled **Photo 1, Photo 2 …**. The API stores no original filename and
`photoRef` is opaque internal data, so the stable id order is the only identity
shown — the browsed filename is deliberately never surfaced.

`photoState(photo)` derives exactly one state per photo (first match wins), and
each state maps to one chip, one summary sentence, an optional "why" line, and
the photo-level actions:

| State           | Condition                                                                        | Chip                         | Summary                                                    | Why line                           | Actions                           |
| --------------- | -------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------- | ---------------------------------- | --------------------------------- |
| `queued`        | `status === 'queued'`                                                            | Waiting                      | Waiting to be read.                                        | —                                  | —                                 |
| `processing`    | `status === 'processing'`                                                        | Reading (pulsing dot)        | Reading the photo…                                         | —                                  | —                                 |
| `failed`        | `status === 'failed'`                                                            | Failed (danger bar)          | Added N games.                                             | `why.failed`                       | Retry photo, Dismiss photo        |
| `unmatched`     | `needs_attention` and `openFlaggedCount > 0`                                     | Needs your decision (accent) | Added N games. K titles need your decision. [+ reviewed M] | `why.unmatched`                    | Dismiss photo                     |
| `nothingFound`  | `needs_attention`, nothing open, `recognizedCount === 0`                         | Needs your decision (accent) | No games recognized.                                       | `why.nothingFound`                 | Dismiss photo                     |
| `countMismatch` | `needs_attention`, nothing open, `declaredCountMismatch`                         | Needs your decision (accent) | Added N games. [+ reviewed M]                              | `why.countFewer` / `why.countMore` | Add a game by hand, Dismiss photo |
| `ready`         | `status === 'done'`, or `needs_attention` with nothing open and no other trigger | Done                         | Added N games. [You reviewed M flagged titles.]            | —                                  | —                                 |
| `dismissed`     | `status === 'dismissed'`                                                         | Dismissed                    | Added N games. You dismissed this photo.                   | —                                  | —                                 |

- The bracketed summary parts appear only when their count is above zero:
  `photoSummary.added` (with `=0 {No games added.}`), `photoSummary.open`,
  `photoSummary.reviewed`, `photoSummary.dismissed`.
- The `ready` row covers a pre-fix `needs_attention` row whose items were all
  reviewed before the settle step existed: nothing is open and no other trigger
  holds, so it reads as done.
- Photos that need a decision carry a left accent bar (`unmatched`,
  `nothingFound`, `countMismatch`) or a danger bar (`failed`); their titles are
  jump targets, and the section summary links to each one.
- A `failed` photo's raw `errorMessage` is tucked into a **Technical details**
  `<details>` disclosure — never the headline.
- `canDismissPhoto(photo)` mirrors the API's `dismissJob` guard
  (`needs_attention` or `failed`), so **Dismiss photo** appears only where the
  API accepts it. A stale button that loses a race gets the API's `409` message
  in the card's error line, and the next refresh hides the control.

# Counts

The counts grid comes from `batchCounts(items, progress)`:

- **Added automatically** = Σ `importedCount` over the batch's photos.
- **Titles to review** = Σ `openFlaggedCount` over the non-dismissed photos
  (`photoReviewCounts(photo).open`) — flagged items with `dismissed_at IS NULL`.
  A reviewed title is never counted, so the cell can reach 0 while
  `unrecognizedCount` stays at its historical value.
- **Failed photos** = the aggregate `failed` count; failure is a photo-level
  outcome, not a per-title counter.
- **Still to process** = the aggregate `pendingCount` (photos, not the summed
  per-job `pendingCount`).

> **There is no distinct "skip" counter.** A photo either adds games, flags
> titles for review, or fails whole. Anything that looks like "skipped" is one
> of those three; do not invent a fourth bucket.

# Flagged titles

A card loads its open flagged titles (`GET /import-jobs/:id/unrecognized`) only
while it needs them: the photo is terminal, not dismissed, and has
`openFlaggedCount > 0`. Each item row shows:

- the raw title and a plain-language reason from `flaggedItemReason(item)`:
  - `ambiguous` — several games match this title (the item has tied
    candidates);
  - `noPlatform` — the game was found but the platform was not
    (`platform_not_in_catalog`);
  - `notFound` — not found in the game database.

  The raw `reason` (provider text such as `IGDB: …`) is **never** rendered; the
  item's `rawPlatform`, when present, is shown as `Platform: …`.

- **Pick** buttons for tied candidates, listed inline (cover, title, `Pick`);
  picking calls `POST /import-jobs/:id/unrecognized/:itemId/pick` and removes
  the item with an "Added …" status.
- **Add manually** — a disclosure that mounts the shared `ManualAddForm` in its
  `variant="compact"` mode: Title and Platform (+ **New platform**) and the
  catalog lookup (search with **Search the game database**, platform-first
  matches, **Pick**). The full form's Edition/year/players/publisher/genre
  fields and its card chrome are not rendered here; the compact hint says the
  rest can be filled in later. Prefill comes from the item's `rawTitle` and
  `matchPlatformId(platforms, rawPlatform)` (unknown → empty, the user picks).
  - **Add to catalog** saves the game and then dismisses the item (the manual
    add is the review decision), reporting `Added “…” to your catalog.`
  - **Save and add another** saves the game and keeps the item open for the
    next one; the form shows its own "Added …" status. The last game is saved
    with **Add to catalog**.
- **Dismiss** — `PATCH /import-jobs/:id/unrecognized/:itemId { dismissed: true }`,
  removing the row and reporting `Dismissed “…”`.
- A per-card error line (`role="alert"`) and status line (`role="status"`) stay
  mounted (visually hidden when empty), so assistive tech announces the outcome.
  Every resolution calls `onChanged()` (a snapshot refetch); when the last open
  item is reviewed, the API settles the job `needs_attention → done` and the
  card's chip becomes **Done** without a reload.

# State through polling

Polling replaces the whole snapshot, so the list is built to keep user state:

- **Stable identity:** every photo is always rendered by the same card in one
  list, keyed by `photo.id`. A state change never moves a photo between
  sections, so nothing remounts.
- **Item rows** are keyed by `item.id`; the open panel is card state
  (`addItemId`). The form draft, the new-platform input and the lookup results
  live inside `ManualAddForm`/`FlaggedItemLookup`, which stay mounted while the
  row and panel exist; `ManualAddForm` reads `initialTitle`/`initialPlatformId`
  only in its `useState` initializer, so new props after a poll never reset the
  input.
- **No item refetch on poll:** the item-list effect depends on a boolean
  (`loadItems`) rather than `photo.status`/`unrecognizedCount`, so it only
  refetches when that boolean goes false → true (a photo finishes, or a retried
  photo finishes again).
- **Confirm dialog:** `confirmingDismiss` is card state and the dialog renders
  only while `canDismissPhoto(photo)` still holds, so a confirmation for a
  photo that is no longer dismissable disappears.
- **Freshness after an action:** every resolution calls `onChanged()`
  (`refreshSnapshot`); the view's snapshot sequence guard keeps an older poll
  from overwriting it.

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

- The aggregate progress bar is the shared `ProgressBar`
  (`apps/web/src/components/progress-bar.tsx`): `role="progressbar"` with
  `aria-valuenow/min/max` and an accessible label naming X and Y. While the
  batch runs (`!allCompleted && !paused`), the determinate fill is drawn muted
  (`bg-accent/40`) and a full-strength accent segment bounces between the
  track's edges over it, so the sweep stays visible across the whole track;
  nothing moves when the queue is paused or the batch has finished.
- The aggregate "X of Y photos processed" line is the **only** polled
  `aria-live` region (`role="status"`, `aria-live="polite"`); the footer
  "Reconnecting…" line and the photo rows are not live, so a noisy list never
  announces on every poll. Each photo card instead keeps **persistent** live
  regions, filled in place: `role="alert"` for load/action errors and
  `role="status" aria-live="polite"` for the post-action and loading messages
  (`sr-only` while empty, so a region that mounts together with its text is
  still announced).
- The paused banner is `role="alert"`; the resume error is `role="alert"`.
- The dismiss-photo confirmation is a `role="alertdialog"` with labelled and
  described ids, focuses its Cancel button (least-destructive) on open, and
  closes on Escape; the flagged-title **Add manually** disclosure is a real
  button with `aria-expanded`/`aria-controls`.
- The section summary's jump links (`Photos that need your decision`) anchor to
  each decision photo's heading; item action buttons carry
  `aria-describedby` pointing at the item's title/reason line, so "Dismiss"
  names what it dismisses; tied-candidate Pick buttons describe their
  candidate.
- When a resolved item row (or its panel) unmounts, focus would fall to
  `<body>`; the card moves it to the photo heading instead (`tabIndex={-1}`).
- Status is conveyed by text as well as the colour dot; the dot is
  `aria-hidden`. The busy dot uses `animate-pulse motion-reduce:animate-none`,
  the progress bar's busy segment is `motion-reduce:hidden` (nothing animates
  under reduced motion), and the decision bars are decorative (`before:`
  pseudo-elements).
- A failed photo's raw `errorMessage` is only inside a native **Technical
  details** `<details>` disclosure, not exposed as a live region.
- All controls are real links/buttons with focus-visible rings; the counts grid
  is a `<dl>`.

# Backend contract

- Batch progress and the job list: [Import Jobs API](import-jobs-api.md)
  (`GET /import-jobs/batches/:batchId`, `GET /import-jobs?batchId=…`).
- The per-photo state needs `openFlaggedCount` on every job payload (flagged
  items with `dismissed_at IS NULL`, counted live for every status) alongside
  the historical `unrecognizedCount` — see [Import Jobs
  API](import-jobs-api.md).
- Review reuses existing endpoints: `GET /import-jobs/:id/unrecognized`,
  `PATCH /import-jobs/:id` (`{ status: 'dismissed' }`),
  `PATCH /import-jobs/:id/unrecognized/:itemId` (`{ dismissed: true }`), and
  `POST /import-jobs/:id/retry` — see [Import Jobs API](import-jobs-api.md).
- Flagged-item re-search and pick are the two newer endpoints:
  `GET /import-jobs/:id/unrecognized/:itemId/search?q=&platformId=` returns the
  ranked candidates (platform first), and
  `POST /import-jobs/:id/unrecognized/:itemId/pick` accepts the optional
  re-search `query` and user-confirmed `platformId` — see
  [Import Jobs API](import-jobs-api.md).
- **Settling:** dismissing an item, picking a candidate and adding a game by
  hand each make the API re-check the job after the write commits; when the
  last open flagged item is reviewed and no other trigger holds
  (`recognizedCount === 0` or a declared-count mismatch), the job moves
  `needs_attention → done` (`settleReviewedJob`). This is why the page's
  "Titles to review" cell and the chip can reach **Done** without a reload.
- `paused` / `pauseReason` / `pauseSource` and `POST /import-jobs/resume`:
  [Queue Pause on Configuration Error](queue-pause-on-config-error.md).

# Manual acceptance script

Setup:

```bash
cp .env.example .env      # SESSION_SECRET (>=32 chars), DB; then save the LLM base URL + key in /settings
docker compose up -d mysql
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
4. **Per-photo detail.** A completed row shows the **Done** chip and "Added N
   games." Now do the same upload with an over-declared count and confirm the
   row's why line explains the mismatch.
5. **Failure.** Upload a corrupt/unreadable photo. Expect a `Failed` row with a
   danger bar, a plain-language why line, the raw reason inside **Technical
   details**, and **Retry photo** / **Dismiss photo** actions.
6. **Reload safety.** Reload the page mid-import; expect the same state, and a
   second tab opened on the URL to converge.
7. **Leave and return.** Navigate to `/`, wait, then use **Check your most recent
   import** on `/import` to return; expect current progress.
8. **Completion.** When every photo is terminal, the heading becomes "Import
   finished" and polling stops (Network tab goes quiet).
9. **Paused banner.** With a bad LLM API key saved in Settings (or reject
   IGDB), start an import. Expect the "Queue paused" banner with the reason
   and a fix hint; the heartbeat is 15 s. Fix the configuration, press
   **Resume queue**, and confirm the import continues.
10. **Paused focus refetch.** While paused, focus another window and return;
    expect one refetch (not a 2 s storm).
11. **No CSP violations.** The console shows no CSP errors from the view.
12. **Re-search and pick.** With real IGDB credentials, trigger a no-match
    flagged item (or seed `raw_title='Filary Ziemi'`, `raw_platform='PC'` as
    below). Open **Add manually**, change the title to "The Pillars of the
    Earth", press **Search the game database**, then **Pick** on a result.
    Expect the item to disappear, the status `Added “…”`, and the created game
    (`/games/<id>`) to have a cover and IGDB metadata. Matches on the selected
    platform are listed first.
13. **Nothing found.** Search `zzzz qqqq`: the inline text reads "Nothing found
    for …" and **Add to catalog** still saves a MANUAL game with the form's
    fields.
14. **Only the app is called.** In DevTools Network, the browser calls only
    `/api/import-jobs/...` (`…/search`, `…/pick`); it never calls IGDB directly.

## Deterministic seed (no LLM/IGDB needed)

A seeded batch exercises the Photos list without a provider. Start everything
with:

```bash
docker compose up -d mysql && npm run db:deploy && npm run db:seed && npm run dev
```

The seed creates the QA account and the PC / PlayStation 5 / Nintendo Switch
platforms. Then load the fixture (re-runnable; the UUIDv7 ids are valid for
`@IsUUID('7')`):

```bash
docker compose exec -T mysql mysql --default-character-set=utf8mb4 -ugameshelf -pgameshelf gameshelf <<'SQL'
DELETE FROM import_jobs WHERE batch_id = 'qa-review';
INSERT INTO import_jobs (id,status,declared_count,photo_ref,recognized_count,imported_count,unrecognized_count,error_message,batch_id,created_at,completed_at,next_run_at) VALUES
('01990000-0000-7000-8000-000000000001','done',NULL,NULL,3,3,0,NULL,'qa-review',NOW(3),NOW(3),NULL),
('01990000-0000-7000-8000-000000000002','needs_attention',NULL,NULL,5,2,3,NULL,'qa-review',NOW(3),NOW(3),NULL),
('01990000-0000-7000-8000-000000000003','needs_attention',6,NULL,4,3,1,NULL,'qa-review',NOW(3),NOW(3),NULL),
('01990000-0000-7000-8000-000000000004','needs_attention',NULL,NULL,0,0,0,NULL,'qa-review',NOW(3),NOW(3),NULL),
('01990000-0000-7000-8000-000000000005','failed',4,'qa-missing.png',2,2,0,'LLM request timed out','qa-review',NOW(3),NOW(3),NULL),
('01990000-0000-7000-8000-000000000006','dismissed',NULL,NULL,1,1,0,NULL,'qa-review',NOW(3),NOW(3),NULL),
('01990000-0000-7000-8000-000000000007','queued',NULL,NULL,0,0,0,NULL,'qa-review',NOW(3),NULL,NULL);
INSERT INTO unrecognized_items (id,import_job_id,raw_title,raw_platform,candidates,reason,created_at) VALUES
('01990000-0000-7000-8000-000000000101','01990000-0000-7000-8000-000000000002','PlayStaton 5','PS4',NULL,'No game matched the title in any source — IGDB: No IGDB game matched the title',NOW(3)),
('01990000-0000-7000-8000-000000000102','01990000-0000-7000-8000-000000000002','Zorblax Chronicles 9000','PlayStation 5',NULL,'No game matched the title in any source — IGDB: No IGDB game matched the title',NOW(3)),
('01990000-0000-7000-8000-000000000103','01990000-0000-7000-8000-000000000002','Rise of Legends','PC','[{"source":"IGDB","externalId":18797,"title":"Rise of Nations: Rise of Legends","slug":"rise-of-nations-rise-of-legends","coverUrl":null,"score":0.95}]','Multiple IGDB candidates matched equally well — choose one',NOW(3)),
('01990000-0000-7000-8000-000000000104','01990000-0000-7000-8000-000000000003','Filary Ziemi',NULL,NULL,'platform_not_in_catalog',NOW(3));
SQL
```

If `.env` uses different MySQL credentials, change `-u`/`-p`.

Log in at `http://localhost:3000/login` as `qa@gameshelf.local` /
`gameshelf-qa-password`, then open
`http://localhost:3000/import/progress/qa-review`. Photo 7 is queued with
`next_run_at NULL`, so it is never claimed and the page keeps polling every 2 s
— which is what makes the state-survival check possible.

Verify:

1. **Overview.** Seven rows, each photo once. Summary: "4 photos need your
   decision.", with links to Photos 2, 3, 4 and 5. Grid: Titles to review = 4.
2. **Photo 2 (unmatched titles).** Reasons show no "IGDB:" text. Dismiss
   `PlayStaton 5` → "Dismissed “PlayStaton 5”." On `Zorblax Chronicles 9000`
   open **Add manually**: only Title and Platform, with PlayStation 5
   prefilled. **Add to catalog** → "Added … to your catalog." `Rise of Legends`
   shows its tied candidate inline; picking needs IGDB credentials (otherwise
   expect an error message), so dismiss it instead. After the last item the chip
   reads **Done** and the summary "Added 2 games. You reviewed 3 flagged
   titles."; Photo 2 leaves the jump links. Network tab: `GET
/api/import-jobs?batchId=qa-review…` shows Photo 2 with
   `"status":"done","openFlaggedCount":0`; `GET
/api/import-jobs/batches/qa-review` shows `needsAttention` lower by 1.
3. **Photo 3 (count mismatch).** Resolve `Filary Ziemi` (the `noPlatform`
   reason). The photo stays **Needs your decision** with the "fewer" why line
   and the **Add a game by hand** link. Dismiss photo → confirm "Dismiss Photo
   3?" → the row reads "Dismissed".
4. **Photo 4.** Nothing-recognized copy, then Dismiss photo.
5. **Photo 5.** Retry → Waiting/Reading, then failed again within about 20 s
   (the photo file does not exist). **Technical details** shows "LLM request
   timed out" or the new reason.
6. **State survives polling.** Open a panel, type in the title, open New
   platform, run a search, and open a dismiss confirmation on another photo.
   Wait at least 6 s (at least 3 polls in the Network tab). Nothing collapses
   and all input is kept.
7. **Other.** Reload: same state. `/games/new`: still shows Edition, Release
   year, Players, Publisher, Genre and the card styling. Switch language
   (Settings → Preferences): Polish copy, no missing keys. Dark theme readable.
   To see "Import finished":
   `DELETE FROM import_jobs WHERE id='01990000-0000-7000-8000-000000000007';`,
   then reload.
8. **No console/CSP errors.**

Cleanup: `DELETE FROM import_jobs WHERE batch_id='qa-review';` (items cascade).
For a clean catalog: `npm run db:clear-dev -- --force && npm run db:seed`.

Optional, dev database only: fix old jobs that were resolved before the settle
step.

```sql
UPDATE import_jobs j SET j.status='done' WHERE j.status='needs_attention' AND j.recognized_count > 0
  AND (j.declared_count IS NULL OR j.declared_count = j.recognized_count)
  AND NOT EXISTS (SELECT 1 FROM unrecognized_items u WHERE u.import_job_id = j.id AND u.dismissed_at IS NULL);
```

# Out of scope

- Blocking uploads while the queue is paused.
- Un-dismissing a photo or item — dismissal is one-way in the backend.
- Resolving a declared-count mismatch inside the import: the count-mismatch row
  links to `/games/new` and offers **Dismiss photo**; there is no in-app
  reconciliation flow.
- Recording _how_ a flagged title was resolved (picked, added by hand, or
  dismissed) — there is no column for it, so the copy says "reviewed".
