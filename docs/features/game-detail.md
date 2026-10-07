---
type: Feature
title: Game Detail View with Edit, Delete & Re-enrich
description: The authenticated /games/[id] route showing every record field including archival raw metadata, inline edit (PATCH), confirmed delete (DELETE), re-enrich from a corrected title (POST /enrich) reporting its outcome, metadata source and last enrichment, the copy count, and catalog tiles linked from the grid.
tags: [web, ui, catalog, enrichment]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-07T22:51:48Z }
---

# Overview

Ticket 5.4 adds the game detail route at `/games/[id]` behind the authenticated
`(app)` shell (the [Web Auth UI](/web-auth-ui.md) session guard), and links every
[Catalog Grid](/catalog-grid.md) tile to it. The page is a **server component**
that reads the id from the route, fetches the [Catalog API](/catalog-api.md)
`GET /games/:id` record and the `GET /platforms` list in parallel, and renders a
presentational `GameDetailView`. Every mutation runs from a small `'use client'`
control that calls the [Web API Client](/web-api-client.md) and then
`router.refresh()`, so the surrounding server-rendered view re-fetches without a
hard reload.

The detail view exists to close the loop opened by import/manual add: a user can
see exactly what was stored (including the archival `rawMetadata`), fix a field,
delete a mistake, or re-run enrichment against a corrected title and read the
outcome.

# Behaviour

| Concern                  | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route / id parsing       | `apps/web/src/app/(app)/games/[id]/page.tsx` (`force-dynamic`); `parseId` accepts `/^\d+$/` and rejects `< 1` or values above `2147483647`; both an unknown id and a 404 from `getGame` call `notFound()` (the generic `app/not-found.tsx`). `/games/new` stays a static segment.                                                                                                                                       |
| Data loading             | `requireUser()` first, then `Promise.all([getGame(id), getPlatforms()])`; `getGame` maps only `404 → null`, other errors propagate.                                                                                                                                                                                                                                                                                     |
| All record fields (AC 1) | A `<dl>` shows Platform, Edition, Release year, Publisher, Genre, Players, Copies, Platform ID, External ID, Source, Added, Updated and Record ID; `null`/empty renders a muted "Not set".                                                                                                                                                                                                                              |
| Raw metadata (AC 1)      | A collapsed read-only `<details>` "Raw metadata (archival)" renders `rawMetadata` pretty-printed (JSON `2`-space indent, raw text fallback, "No raw metadata stored." when null) in `font-mono text-xs`, `max-h-96` scroll, muted.                                                                                                                                                                                      |
| Provenance (AC 5)        | A chip row shows `Source: Manual \| IGDB \| MobyGames` and `Last enriched: …` (or "Never enriched"); `platformUnverified` adds a `text-danger` "Platform unverified" chip.                                                                                                                                                                                                                                              |
| Hand-edited markers      | A field in `game.userEditedFields` (`releaseYear`/`publisher`/`genre`/`playerCount`) gets a small muted "hand-edited" marker.                                                                                                                                                                                                                                                                                           |
| Copy count (AC 6)        | `game.copyCount` is a record row ("Copies").                                                                                                                                                                                                                                                                                                                                                                            |
| Edit (AC 2, 7)           | `GameEditForm` toggles an inline form; `buildDelta` sends **only changed keys** (`PATCH` marks every present tracked field as hand-edited, so untouched fields are omitted). Text clears to `null`, numbers are bounded client-side. Success calls `router.refresh()` and keeps a `role="status"` "Saved." banner.                                                                                                      |
| Delete (AC 3, 7)         | `DeleteGameButton` uses a two-step inline `role="alertdialog"` (no `window.confirm`); Cancel is focused on reveal and Escape cancels. Confirm calls `DELETE /games/:id`, then `router.push('/')` + `router.refresh()`. A `404` is treated as already gone and still navigates away.                                                                                                                                     |
| Re-enrich (AC 4, 7)      | `ReEnrichControl` runs the two-step `POST /games/:id/enrich`: search (`{}`) then apply (`{ candidate: { source, externalId } }`). Outcomes are reported in a `role="status"` region: "Found a match.", "No match found … Nothing changed.", "Fresh metadata applied.", "Already up to date — nothing changed.", or the `409` "That match is no longer available. Run the search again." Apply calls `router.refresh()`. |
| No hard reload (AC 7)    | Every mutation uses `router.refresh()` (RSC re-fetch), matching the login/logout pattern; no `window.location` reload.                                                                                                                                                                                                                                                                                                  |
| Catalog tiles (AC 8)     | `GameCard` wraps its cover + title/platform in a `next/link` `Link` to `/games/[id]`; the shared `GameCover` frame gains `group-hover:border-accent/70` (with `motion-reduce:transition-none`).                                                                                                                                                                                                                         |
| Dates                    | Rendered server-side in fixed UTC (`en-GB`, `dateStyle: medium`, `timeStyle: short`) so there is no hydration mismatch.                                                                                                                                                                                                                                                                                                 |

# Components

- `apps/web/src/app/(app)/games/[id]/page.tsx` — the route; id parsing, parallel fetch, `notFound()`.
- `apps/web/src/components/game-detail-view.tsx` — `GameDetailView`, `DataRow`, `Chip`, `formatDateTime`, `sourceLabel`, `prettyRaw`.
- `apps/web/src/components/game-edit-form.tsx` — `'use client'` `GameEditForm`, `buildDelta`, `toDraft`, `boundedInt`, `textDelta`.
- `apps/web/src/components/delete-game-button.tsx` — `'use client'` `DeleteGameButton` (inline confirmation).
- `apps/web/src/components/re-enrich-control.tsx` — `'use client'` `ReEnrichControl` (search → apply state machine).
- `apps/web/src/components/game-card.tsx` — `GameCard` now links each tile to `/games/[id]`.
- `apps/web/src/components/game-cover.tsx` — `FRAME` gains the hover affordance.
- `apps/web/src/lib/api/server.ts` — new `getGame` (404 → null) and `getPlatforms` helpers.

# Out of scope

- Editing `copyCount`, the cover, `source` or `enrichedAt`; an "add another copy" action (the API endpoint exists but is not surfaced here).
- The real manual-add form (ticket 5.5).
- Loading skeletons, route `error.tsx`, focus management polish, and a frontend test runner (ticket 5.6).
- i18n (ticket 7.2), platform management (ticket 7.1).
- Any backend or `packages/contracts` change — the endpoints already existed.

# Manual acceptance

1. Open a catalog tile: it navigates to `/games/<id>` and shows the cover, title, platform · edition · year, and the provenance chip row.
2. The record list shows every field (including Copies, External ID and Record ID); empty fields read "Not set".
3. Expand "Raw metadata (archival)": it shows pretty-printed JSON (or "No raw metadata stored.") and is read-only.
4. **Edit record** → change the publisher → **Save changes**: "Saved." appears and the record row updates without a full page reload. Return to `/`: the tile reflects the new title (if changed).
5. Clearing an optional field to blank and saving sends `null` (the row returns to "Not set").
6. A field edited here shows the "hand-edited" marker afterwards; a later re-enrich does not overwrite it.
7. **Delete game** → **Delete game**? shows the inline confirmation; **Cancel** (focused) or Escape closes it; **Delete** removes the game and returns to `/`.
8. **Re-enrich from title** with a corrected title: a matched candidate card appears (title/year/publisher/genre/players/platforms/same-origin cover); **Apply metadata** reports "Fresh metadata applied." (or "Already up to date — nothing changed.") and the record updates in place. An unresolved title reports "No match found for … Nothing changed."
9. Every cover request (tile, detail, candidate preview) is same-origin; no CSP violation appears in the Console.
10. `/games/abc` and `/games/999999` render the 404 page; `/games/new` still renders the manual-add placeholder.
