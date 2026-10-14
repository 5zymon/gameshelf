---
type: Feature
title: Platforms UI
description: The /platforms management view — the canonical platform list every import matches against, with game counts, add/rename/delete/hide, merge-with-alias, an import-created review block, and canonical-vs-manual badges.
tags: [web, ui, platforms]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-08T06:04:33Z }
---

# Overview

The `/platforms` route replaces the placeholder that rendered since ticket 0.x
and becomes the owner's screen for the catalog's platform reference list: the
visible half of the duplicate-prevention design (spec §4.6; workflow 4.6,
decision #7). It reads the existing [Platforms API](platforms-api.md) and lets
the owner keep that list canonical without touching the database:

- list every platform with its `gameCount`;
- **add** a custom platform;
- **rename** (the previous name is kept as an alias);
- **delete** a custom platform, or **hide** a reference one;
- **merge** one platform into another (moves its games, keeps the merged name
  matchable);
- review platforms the import **created** for unknown names and either keep,
  rename, or merge them.

This is a frontend-plus-docs ticket: every endpoint it calls already exists and
is tested (see [Platforms API](platforms-api.md)). No backend or
`@gameshelf/contracts` change.

# Platform shapes

The Platforms API encodes three row shapes with no `kind` column; this view
derives a badge and an action set from the row fields (`lib/platforms.ts`,
`platformKind`). `addedByImport` wins over `igdbId`: an import row stays
"awaiting review" even after a sync links it, until it is confirmed or merged.

| Shape          | Marker                             | Badge           | Actions                                                                                                                              |
| -------------- | ---------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Import-created | `addedByImport == true`            | Added by import | **Keep as is**, **Merge into…**, **Rename**, plus **Delete** (`igdbId == null`) or **Hide**/**Show** (`igdbId != null`, sync-linked) |
| Reference      | `igdbId != null && !addedByImport` | Reference       | **Rename**, **Merge into…**, **Hide** (or **Show** if hidden)                                                                        |
| Manual         | `igdbId == null && !addedByImport` | Manual          | **Rename**, **Merge into…**, **Delete**                                                                                              |

Delete-vs-hide is decided by `igdbId` alone, not by the badge: any row with an
`igdbId` — a reference row, or an import row a sync has linked (`addedByImport`
stays true until confirmed, but `igdbId` is set) — gets **Hide**/**Show**, since
`DELETE /platforms/:id` only hides such a row. A hidden platform also carries a
**Hidden** chip. Each kind badge carries a `title` tooltip explaining it.

# Default view vs full list

`GET /platforms` returns every row (roughly 200 IGDB reference platforms in a
synced install), so the view filters client-side rather than rendering them all:

- **Default** — non-hidden platforms with `gameCount > 0`, plus non-hidden
  custom/user-created platforms (`igdbId == null && !addedByImport`), which are
  always shown so a freshly added row appears immediately even with zero games,
  plus every unreviewed import row (always shown in its own review block,
  regardless of the toggle). A hidden platform is excluded even when it still
  has games, so **Hide** has a visible effect; the toggle is the only path that
  reveals hidden rows. Reference platforms (`igdbId != null`) with no games stay
  hidden unless the toggle is on.
- **Show empty and hidden reference platforms** — a checkbox that reveals the
  full list, including reference platforms with no games and hidden ones.

A custom platform that a sync/refresh later links to an IGDB id becomes a
reference row, and with zero games it leaves the default view until the toggle
is on.

With the toggle off and nothing to show, the list reads "No platforms to
show…"; on a genuinely empty catalog it reads "No platforms yet. Add one, or
import games to create them."

# Actions

| Action      | Endpoint                                   | Notes                                                                                                                 |
| ----------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Add         | `POST /platforms` `{ name }`               | `409` (duplicate name or alias owner) shows the API message plus "It already exists — rename or merge it instead."    |
| Rename      | `PATCH /platforms/:id` `{ name }`          | Inline form; helper text states the previous name is kept as an alias. Renaming to the current name is a `200` no-op. |
| Delete      | `DELETE /platforms/:id`                    | Two-step `role="alertdialog"`; never-linked rows only (`igdbId == null`).                                             |
| Hide / Show | `PATCH /platforms/:id` `{ name, hidden }`  | Any linked row (`igdbId != null`). `name` is always resent because `UpdatePlatformDto.name` is required.              |
| Keep as is  | `POST /platforms/:id/confirm`              | Import rows only; clears `addedByImport`.                                                                             |
| Merge into… | `POST /platforms/:id/merge` `{ targetId }` | Opens the merge dialog (one instance for every row).                                                                  |

Every successful mutation calls `router.refresh()`, which re-renders the
server page and re-fetches `GET /platforms` without a hard reload. Every action
maps a `401` to `/login`, a `404` to "This platform no longer exists." plus a
refresh, and a status-`0` failure to a connection message; a `409` surfaces the
API's `userMessage` verbatim.

# Delete-with-games is blocked, never orphaned

Deleting a platform that still has games is non-destructive: the API returns
`409` naming the count and nothing is removed (spec §4.6.5). The dialog then
shows that message, the hint "Reassign its games first — merge it into another
platform, or edit each game.", and a **Merge into…** button that opens the merge
dialog. Any platform with an `igdbId` — a reference row, or an import row a sync
has linked — is never deleted at all: **Hide** removes it from the list (a later
refresh restores it), matching the API's hide-not-delete rule.

# Merge preview and the alias guarantee

`PlatformMergeDialog` fetches `GET /games?platformId=<sourceId>&limit=100` on
open to preview the move: it shows "Move N games" (the API's `meta.total`) with
up to ten game titles and a "+N more" remainder. A failed preview degrades to
N = `source.gameCount` and does not block the merge; a `401` redirects to
`/login`.

The target `<select>` lists every other visible platform (the source is
excluded). The confirmation copy is explicit about the alias guarantee:

```
Move N games from “<source>” to “<target>”? “<source>” is kept as an alias so
future imports still match it; the platform is then removed.
```

Confirming calls `POST /platforms/:id/merge`; on success the dialog closes and
the list refreshes. The dialog is `role="dialog"`/`aria-modal`, focuses the
target select on open, keeps Tab within the dialog (mirroring the delete
confirmation's trap), closes on Escape or a backdrop click, and returns focus to
the row's **Merge into…** trigger on close.

# Reassigning a game's platform

Reassigning a **game** between platforms is not done here — it already lives in
the game detail editor: `GameEditForm`'s Platform `<select>` sends
`delta.platformId` to `PATCH /games/:id`
([Game Detail View](game-detail.md), `game-edit-form.tsx:312-331`,
`buildDelta` at `:105-113`). This view surfaces the block and points at merge;
the per-game edit remains the fine-grained path.

# Manual acceptance script

1. Open `/platforms`. The heading and the "canonical list" explanation render;
   every visible row shows its game count.
2. **Add a platform**: type a new name and submit → the row appears in the
   default list immediately with count 0 (custom platforms are always visible).
   Submitting an existing name shows the `409` message and "It already exists —
   rename or merge it instead."
3. **Rename** a row → the inline form opens with the current name focused; save
   → the row reflects the new name, and a later re-import reading the old name
   still resolves to it (the API wrote the alias).
4. **Hide** a reference platform → it leaves the default list and, once the
   full-list toggle is on, shows the **Hidden** chip and a **Show** action;
   **Show** restores it.
5. **Delete** a custom platform with no games → the confirmation dialog opens
   with Cancel focused, Tab cycles Cancel/Delete, Escape cancels; Delete removes
   the row.
6. **Delete** a platform that has games → the dialog shows the `409` count
   message plus the reassignment hint and a **Merge into…** button.
7. **Merge into…** → the dialog previews "Move N games" with titles, lists every
   other platform except the source, and states the alias guarantee. Confirming
   moves the games and removes the source row.
8. **Import review**: after an import that met an unknown platform name, the
   "Added by import — review" block lists it at the top with an **Added by
   import** badge and **Keep as is**; confirming clears the badge and the block
   once the list refreshes.
9. Toggle **Show empty and hidden reference platforms** → the full (≈200-row)
   list appears; with it off the default list renders — non-hidden platforms
   with games, non-hidden custom platforms, and unreviewed imports.
10. The console shows no CSP violations.

# Related

- [Platforms API](platforms-api.md) — every endpoint this view calls, the
  delete-or-hide rules, and the alias/merge mechanics.
- [Game Detail View with Edit, Delete & Re-enrich](game-detail.md) — the
  per-game platform reassignment this view defers to.
- [Web API Client](web-api-client.md) — `api.platforms.*` and `api.games.list`.
- [LLM Settings UI](llm-settings-ui.md) — hosts "Refresh platforms"
  (`POST /platforms/refresh`), which restores hidden reference platforms.

# Out of scope

- Any backend or `@gameshelf/contracts` change — the endpoints and wire types
  already exist.
- Bulk platform-scoped game reassignment; aliases are not editable directly
  (they are written by rename and merge).
- A merge-preview endpoint (the preview reuses `GET /games?platformId=`).
- A dedicated hide/unhide endpoint (hide/show reuses `PATCH`).
- Moving "Refresh platforms" off `/settings`.
- i18n (ticket 7.2), theme (ticket 7.3), and pagination; verification is
  typecheck + lint + build, the `node --test` unit tests (including
  `test/platforms.test.mjs` for the default-view filter), and the manual
  acceptance script above.
