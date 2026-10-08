---
type: Feature
title: Manual Add Form
description: The authenticated /games/new typed-only form — title, platform (select or inline create), edition and optional metadata, with save-and-add-another, field-level errors, and an existing-identity copy prompt.
tags: [web, ui, catalog]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-07T23:46:14Z }
---

# Overview

`/games/new` is the manual entry path into the catalog: an authenticated user
types a game's title, picks (or creates) a platform, adds an edition and any
optional metadata, and saves. It is **typed-only** — it never calls
`GET /games/search` and always creates an unlinked record (`source: "MANUAL"`,
`externalId: null`), so it works with no LLM key and with no game database
configured. This closes the "Add a game" link in the empty [Catalog
Grid](/catalog-grid.md) state and the `POST /games` typed-only branch of [Manual
Add with DB Search and Copy Count](/manual-add-and-copy-count.md).

# Behaviour

| Concern                    | Behaviour                                                                                                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minimal create (AC 1)      | Submitting with only title, platform and edition sends `POST /games` `{ title, platformId, edition }` (blank optional fields are omitted). A `201` shows a success banner and clears the form.                                                                                           |
| Platform select (AC 2)     | A `<select name="platformId">` is populated from the server-fetched `GET /platforms` list. The first option is a disabled "Choose a platform…".                                                                                                                                          |
| Inline platform create     | **New platform** toggles an inline name input; **Create platform** calls `POST /platforms`, appends the returned row to the select and auto-selects it. A `409` reloads the list and selects the existing platform by name.                                                              |
| Save and add another       | A second submit button (`name="intent" value="save-and-add-another"`) keeps the platform selected, clears title/edition/metadata, and focuses the title for bulk entry. **Save game** is the implicit Enter default.                                                                     |
| Client validation (AC 4)   | `buildCreateRequest` mirrors `CreateGameDto` (title required/≤255; platform integer ≥1; edition/publisher/genre ≤255; year 1000–2100; players 1–100). The first bad field is focused; submit buttons stay enabled so a click surfaces the error.                                         |
| Server validation          | A `400` maps each class-validator message to a field by its leading property token (`mapServerErrors`); the unknown-platform string maps to `platformId`; anything else is form-level.                                                                                                   |
| No LLM / no game DB (AC 5) | The form imports only `api.games.create`, `api.games.addCopy`, `api.platforms.create`/`list`. It never probes an external catalog. A saved record shows `Saved “X”. Not linked to a game database.`                                                                                      |
| Existing identity (AC 7)   | `isGameConflict(error)` opens an inline `role="alertdialog"` — "…is already in the catalog. … Add another copy?" — whose **Add another copy** calls `api.games.addCopy(game.id)` and reports the new count. No second row is created.                                                    |
| Unlinked chip (AC 8)       | The [Game Detail](/game-detail.md) header gains a muted **Not linked** chip when `externalId === null`.                                                                                                                                                                                  |
| Keyboard accessibility     | Real `<label htmlFor>`/`id` pairs, visible focus rings, `aria-invalid` + `aria-describedby`, `role="alert"`/`role="status" aria-live="polite"`; the conflict dialog focuses its dismiss button and closes on Escape; the inline platform create focuses its input and cancels on Escape. |

# Components

- `apps/web/src/app/(app)/games/new/page.tsx` — `NewGamePage` (`force-dynamic`); `requireUser()` then `getPlatforms()` and renders `ManualAddForm`.
- `apps/web/src/components/manual-add-form.tsx` — `'use client'` `ManualAddForm`, `readIntent`, `savedMessage`.
- `apps/web/src/lib/manual-add.ts` — pure helpers: `ManualAddDraft`, `MANUAL_ADD_FIELDS`, `emptyManualAddDraft`, `boundedInt`, `buildCreateRequest`, `mapServerErrors`.

# Decisions

- **D1 — typed-only.** The form never calls `GET /games/search` and has no candidate/search UI. Every record is created unlinked, which makes "works with no LLM" and "works with no game DB" true by construction.
- **D2 — no `coverUrl`.** Manual records omit the cover and fall back to the existing gradient placeholder from [Catalog Grid](/catalog-grid.md).
- No backend or `packages/contracts` change: `POST /games`, `POST /games/:id/copies`, `GET /platforms` and `POST /platforms` already existed. No new dependencies: a hand-rolled controlled component using the existing Tailwind tokens.

# Out of scope

- External DB search and candidate picking (the linked-create branch of `POST /games`); see [Manual Add with DB Search and Copy Count](/manual-add-and-copy-count.md).
- `coverUrl` entry, a grid-tile copy-count badge, a platform management page, i18n, and a frontend test runner.

# Manual acceptance

1. With a title, platform and edition only, **Save game** creates the record, shows `Saved “…”`, and clears the form while keeping the platform.
2. With no platforms yet, the inline create creates one and auto-selects it.
3. **Save and add another** keeps the platform and focuses the title for the next entry.
4. Clearing the title and submitting focuses the title with `Title is required.`; an out-of-range year focuses the year field.
5. Submitting a title that already exists shows the copy prompt; **Add another copy** reports the incremented count and adds no row.
6. With no game database configured, saving still succeeds and the banner says `Not linked to a game database.`; the detail view shows the **Not linked** chip.
7. Every control is reachable by keyboard; the conflict dialog and inline platform create both close on Escape.
