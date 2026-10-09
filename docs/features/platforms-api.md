---
type: Feature
title: Platforms API
description: Platform CRUD (GET/POST/PATCH/DELETE /platforms) with per-platform game counts and the canonical IGDB platform list reconciled locally by an operator sync command.
tags: [api, platforms, catalog]
status: stable
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-09T21:05:43Z }
---

# Overview

The platforms API manages the catalog's platform reference list (spec §4.6):
list, create, rename, merge, confirm, and delete/hide platforms. Every response
carries the platform's `gameCount`, so the platforms view can show how many
games sit on each platform without extra requests. The canonical IGDB platform
list is **fetched once and stored locally** by an operator-run sync command
(`npm run platforms:sync`), not by a committed seed migration; per-game imports
read the local table only (see [Canonical platform list](#canonical-platform-list)).

Platforms come in three shapes, distinguished by the row itself (no `kind`
column):

| Shape              | Marker                             | Notes                                                              |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------ |
| **Reference**      | `igdbId != null`                   | Loaded by the sync; matching targets, not user data.               |
| **Custom**         | `igdbId == null && !addedByImport` | Created by the user via `POST /platforms`.                         |
| **Import-created** | `addedByImport == true`            | Created by the import for an unknown name; awaits review (§4.6.6). |

# Endpoint contract

| Method   | Path                     | Purpose                                                                                  | Success                    | Errors              |
| -------- | ------------------------ | ---------------------------------------------------------------------------------------- | -------------------------- | ------------------- |
| `GET`    | `/platforms`             | All platforms with a `gameCount` each; import-created first, then name                   | `200` `PlatformModel[]`    | —                   |
| `GET`    | `/platforms/:id`         | One platform by id, with `gameCount`                                                     | `200` `PlatformModel`      | `400`, `404`        |
| `POST`   | `/platforms`             | Create a custom platform (slug is generated)                                             | `201` `PlatformModel`      | `400`, `409`        |
| `PATCH`  | `/platforms/:id`         | Rename (old name kept as an alias); set/clear canonical fields; toggle `hidden`          | `200` `PlatformModel`      | `400`, `404`, `409` |
| `POST`   | `/platforms/:id/confirm` | Confirm an import-created platform (clears `addedByImport`)                              | `200` `PlatformModel`      | `400`, `404`        |
| `POST`   | `/platforms/:id/merge`   | Merge a platform into a target (move games, keep name as an alias, delete it)            | `200` `PlatformModel`      | `400`, `404`, `409` |
| `DELETE` | `/platforms/:id`         | Delete a custom platform, or hide a reference platform; refused while games reference it | `204` (no body)            | `400`, `404`, `409` |
| `POST`   | `/platforms/refresh`     | Refresh the reference platform list from IGDB; restores hidden reference platforms       | `200` `PlatformSyncResult` | `503`               |

`POST /platforms/:id/merge` takes `{ "targetId": <number> }` in the body.
`GET /platforms` orders `addedByImport: true` rows first, then by name, so the
platforms view can lead with rows awaiting review.

`PlatformModel` response shape:

```json
{
  "id": 1,
  "name": "PlayStation 5",
  "abbreviation": "PS5",
  "alternativeName": "PS5",
  "platformFamily": 1,
  "igdbId": 130,
  "slug": "playstation-5",
  "addedByImport": false,
  "hidden": false,
  "gameCount": 12
}
```

`abbreviation`, `alternativeName`, `platformFamily`, and `igdbId` are `null`
for custom platforms and for canonical platforms that IGDB does not carry those
fields for. `platformFamily` is IGDB's platform-family reference id, stored
faithfully and not used for matching. `addedByImport` marks a platform the
import created for an unknown name (see
[Import-created platforms](#import-created-platforms)); `hidden` marks a
reference platform hidden via `DELETE` (see
[Delete behaviour](#delete-behaviour)).

# Duplicate name (409)

`name` is unique case-insensitively — the `platforms.name` column uses the
table collation `utf8mb4_unicode_ci` (ADR-001), so `POST` / `PATCH` with a
name that differs only in case or surrounding whitespace from an existing
platform returns:

```
409 Conflict — A platform named "PlayStation 5" already exists
```

The check is the database unique constraint (Prisma `P2002` on `name`), not a
pre-query, so two concurrent creates cannot both succeed.

A name that is already stored as an **alias** of a different platform (see
[Merge & aliases](#merge--aliases)) is also rejected with `409`:

```
409 Conflict — The name "PlayStaton 5" is already used as an alias by another platform
```

# Delete behaviour

A platform that still has games **cannot be deleted** (spec §4.6.5: "A
platform that has games cannot be deleted — its games must be reassigned
first"). `DELETE /platforms/:id` therefore:

1. Returns `404` if the platform does not exist.
2. Counts the platform's games; if the count is greater than zero, returns
   `409` with a message naming the count — nothing is deleted
   (non-destructive).
3. If the platform is a **reference** platform (`igdbId != null`), it is
   **hidden**, not deleted: `hidden` is set to `true` and `204` is returned.
   The row stays (a later `platforms:sync` or `POST /platforms/refresh` would
   bring a hidden reference row back), and `GET /platforms/:id` still returns
   `200` with `hidden: true`.
4. Otherwise (custom or import-created) it is deleted and `204` is returned.

Unhide with `PATCH /platforms/:id` sending the current `name` and
`hidden: false`, or re-run the refresh (`POST /platforms/refresh`) — the
reconcile clears `hidden` on any reference row it matches (see
[Refresh endpoint](#refresh-endpoint)).

The foreign key `games.platform_id → platforms.id` is `ON DELETE RESTRICT`,
which is the backstop for the race where a game appears between the count and
the delete: the delete then fails with a FK violation (`P2003`) and the API
maps it to the same `409`.

# Rename semantics

`PATCH /platforms/:id` takes a required `name` plus optional canonical fields
(`abbreviation`, `alternativeName`, `igdbId`) and `hidden`. An explicit `null`
clears a field; omitting it leaves it untouched. (The sync command writes the
canonical link directly through `PlatformsSyncService`, not through this
endpoint.)

- The rename changes only the displayed name. **The slug is never rewritten**
  (spec §4.6.4), so `slug` is stable across renames and existing game rows
  are untouched (the FK is on `id`, not `name` or `slug`).
- **The previous name is written as an alias** (normalized) in the same
  transaction, so matching against the old name keeps working — nothing in the
  games table changes (see [Merge & aliases](#merge--aliases)).
- Renaming a platform to its own current name is a `200` no-op, not a `409`.
- Renaming to another platform's name, or to a name another platform already
  owns as an alias, is a `409`.
- Renaming an unknown id is a `404`.

# Merge & aliases

`POST /platforms/:id/merge` merges a **source** platform into a **target**
(`{ "targetId": <number> }`), implementing spec §4.6.4 ("the merged name is
kept as an alias so future imports match it"). In one transaction it:

1. Reassigns every game on the source to the target
   (`game.updateMany`).
2. Re-points the source's existing aliases to the target.
3. Adds the source's `name`, `abbreviation`, and `alternativeName`
   (normalized) as aliases of the target.
4. Deletes the source row.

The response is the target `PlatformModel` with a fresh `gameCount`.

Aliases live in `platform_aliases` (`platform_id`, `name`,
`normalizedName`). `normalizedName` is `normalizePlatformName(name)` and is
**globally unique**, so one alias key has exactly one owner. The matcher treats
aliases as extra keys alongside `name`/`abbreviation`/`alternativeName`
(see [Matching rules](#matching-rules)). This is the mechanism behind two spec
behaviours: a merge keeps the merged-away name matchable, and a rename keeps
the old name matchable.

- `sourceId === targetId` → `400`.
- Unknown source or target → `404`.
- A game inserted on the source concurrently is caught by the FK and mapped to
  `409`.

Given an import-created "PlayStaton 5" merged into "PlayStation 5", a later
import reading "PlayStaton 5" resolves to "PlayStation 5".

# Import-created platforms

An import that reads a platform name matching no existing platform creates the
platform, flagged `addedByImport: true` (spec §4.2.3/§4.6.6; see
[Import Jobs API](/import-jobs-api.md)). The normalized name is matched against
reference, custom, and previously import-created platforms **and their
aliases** before creating, so the same unknown name never produces two rows
(the `platforms.name` unique and `platform_aliases.normalized_name` unique are
the concurrency backstops).

Import-created platforms:

- lead the `GET /platforms` list (`addedByImport desc, name asc`);
- carry a `gameCount` like any platform;
- are cleared by `POST /platforms/:id/confirm` (user keeps them as is);
- are removed by merging them into an existing platform
  (`POST /platforms/:id/merge`);
- are treated as custom (had no `igdbId`) after confirmation, so a later
  `platforms:sync` can adopt them by name if IGDB carries that name.

# Slug rules

- Generated on create: the name is slugified (NFKD-normalized, lowercased,
  non-alphanumeric runs collapsed to `-`, leading/trailing `-` stripped); an
  empty result falls back to `platform`.
- On collision the service appends `-2`, `-3`, … until a free slug is found.
  A concurrent create that snipes the reserved slug is retried with a fresh
  reservation (up to 3 attempts, then a `500`).
- Slugs are **never rewritten afterwards** — neither rename nor the platform
  sync touches them, so a stable slug survives renames and re-syncs.

# Game counts

- `GET /platforms` issues **exactly two queries** for any number of
  platforms: one `findMany` for the platforms and one `game.groupBy`
  aggregate over `platformId`. The per-platform counts come from that single
  aggregate — never one `count` per platform (no N+1). Platforms with no
  games report `gameCount: 0`.
- `GET /platforms/:id` issues two parallel queries (`findUnique` + a single
  `count` scoped to that platform).
- The same count check drives the `409` on delete (see above).

# Canonical platform list

Decision (settles the platform-list open question in ADR-003; **supersedes** the
earlier committed-seed-migration decision): the canonical IGDB platform list is
**populated lazily and refreshed by an operator-run command**, not by a
committed seed data-migration. Rationale: IGDB credentials are not present in
every environment, matching must reconcile against whatever rows that
environment already has (custom platforms included), and the same command
doubles as the documented refresh path. No seed migration is committed.

Refresh with:

```sh
npm run platforms:sync
```

The command (`apps/api/src/cli/platforms.ts` → `PlatformsSyncService`) fetches
the whole list in **one** `POST https://api.igdb.com/v4/platforms` call through
the shared [IGDB Client & Rate Limiter](/igdb-client.md) (fields `name`,
`abbreviation`, `alternative_name`, `platform_family`, `slug`; `limit 500`),
reconciles it against the local `platforms` table, and prints one summary line:

```
Platforms synced: fetched=<n> created=<n> updated=<n> unchanged=<n>
```

- IGDB ids are stored in `platforms.igdb_id`; the family reference id in
  `platforms.platform_family`.
- `name` and `slug` are **never rewritten**, so custom names and stable slugs
  survive a sync. The run is idempotent: a second run creates nothing and
  reports every row `unchanged`.
- Missing credentials or any upstream failure print `Error: …` and exit
  non-zero without touching the database.
- The command is operator-run; concurrent runs could race on a slug/name
  insert, but because the operation is idempotent a retry is safe.

## Refresh endpoint

`POST /platforms/refresh` exposes the same reconcile over HTTP for the
[LLM Settings UI](/llm-settings-ui.md) ("refresh platforms" button), backed by
the same `PlatformsSyncService` the command uses.

- Success → `200` with `PlatformSyncResult`:
  `{ "fetched": 200, "created": 3, "updated": 1, "unchanged": 196 }`.
- `IgdbConfigError` (missing/rejected credentials) → `503` —
  "The game database is not configured or rejected the credentials".
- Any other `IgdbError` (transient) → `503` —
  "The game database could not be reached; try again later".
- The fetch happens before any write, so a failure writes nothing.
- Auth is the global `SessionGuard`; there is no `@Public()` opt-out.

Unlike the command, the endpoint also **restores hidden reference platforms**:
`PlatformsService.updateCanonical` treats a hidden row as changed even when
every canonical field already matches and clears `hidden`, counting it as
`updated`. A reference platform hidden via `DELETE /platforms/:id` therefore
reappears (the same row, `hidden: false`) after a refresh; nothing is deleted.
A hidden platform that later gains a game is likewise unhidden by a refresh,
consistent with "refresh restores the reference list".

## Matching rules

`findPlatformMatch` (`apps/api/src/platforms/platform-match.ts`) is the single
matcher shared by the sync command and the per-game import:

- **Anchored equality only**, applied to whole normalized
  names/abbreviations/alternative names/aliases — no fuzzy or containment
  matching, so `PlayStation 4` never force-matches `PlayStation 5`.
- Normalization is case-, diacritic-, punctuation-, and whitespace-insensitive
  (`Święta` → `swieta`, `PlayStation-5` → `playstation 5`) and expands `&` to
  `and`.
- Aliases (old names from a rename, merged-away names) are extra keys on the
  owning platform.
- `findPlatformMatch` itself is **pure**: both index keys and input keys are the
  plain normalized form. `platforms:sync` uses it directly, so an IGDB
  canonical name matches its own row by exact name — a row named
  `PC (Microsoft Windows)` with no abbreviation is reused, never recreated.
- PC media-banner notations (`PC DVD ROM`, `PC-DVD-ROM`, `PC (Windows)`,
  `Microsoft Windows`) are handled by `expandPlatformInputs`, an explicit
  ordered **input expansion** used only where the photo platform is matched: it
  yields the canonical equivalents (`PC`, then `PC (Microsoft Windows)`) first,
  then the literal input, so the canonical row wins. It is not fuzzy — a value
  is expanded only on an exact normalized key hit, so `PC Engine` still never
  force-matches `PC` — and because it never touches the index, two distinct
  local rows (e.g. a legacy `Windows` row and `PC (Microsoft Windows)`) can
  never collapse onto one key.
- Per-game import resolves the **raw platform read off the photo first** — the
  physical item is authoritative — then the candidate's name/abbreviation only
  when the raw platform is blank, then the candidate's canonical IGDB id (the
  **first candidate in catalog order**, never an arbitrary lowest-local-id
  pick).
- A key shared by two distinct platform ids is treated as **ambiguous** and
  never matched; blank keys are skipped.
- An unknown platform is created by the sync. A per-game import also creates
  one now, flagged `addedByImport` (see
  [Import-created platforms](#import-created-platforms)); it returns `null`
  only when the item has no usable platform name at all.
- **Residual limitation**: when the canonical PC row is absent, the banner
  spellings in the expansion table are not collapsed against each other, so
  `PC DVD ROM` and `PC CD ROM` can each create a distinct flagged
  `addedByImport` row in the same import. Review/merge reconciles them; a
  pre-seeded canonical `PC` row avoids the split.

Because the list is stored locally, per-game imports make **zero**
platform-list calls: `resolvePlatformId` reads the local `platforms` table (in
one query, aliases included) and then matches — it never fetches IGDB.

The spec's "refresh from Settings" (§4.6.1) is served by
`POST /platforms/refresh` (see [Refresh endpoint](#refresh-endpoint)), which
re-runs this same reconcile flow; the operator command remains for scripted use.

# 400 semantics

The global `ValidationPipe` runs with `whitelist` + `forbidNonWhitelisted` +
`transform`:

- `:id` is transformed with `class-transformer` and must be an integer ≥ 1
  (`PlatformIdParamDto`); `abc`, `0`, or `1.5` → `400`.
- `POST` / `PATCH` bodies must match `CreatePlatformDto` /
  `UpdatePlatformDto`; unknown properties → `400`.
- A `name` that is blank after trimming passes the validator (`@IsNotEmpty`
  checks the raw string) and is rejected by the service with
  `400 — name must not be blank`.
- `PATCH` canonical fields are validated when present: `abbreviation` /
  `alternativeName` must be strings ≤ 255 chars, `igdbId` an integer ≥ 1
  (or an explicit `null` to clear).

# Out of scope

- **Reassigning games between platforms** — done via the games API
  ([Catalog API](/catalog-api.md)); this API only refuses deletes that would
  orphan games.
- **The platforms view** (default = non-hidden platforms with games +
  non-hidden custom platforms + unreviewed imports; toggle for the full list)
  — frontend; this API serves the data it needs.
- **Per-import "platforms added by this import" listing** — a later import
  concern; the row flag `addedByImport` is the durable record.
- **Bulk platform-scoped reassignment** — per-game `PATCH /games/:id`
  ([Catalog API](/catalog-api.md)) already implements reassignment.
- **The full platforms management view** (default = non-hidden platforms with
  games + non-hidden custom platforms + unreviewed imports; toggle for the full
  list) — frontend; `POST /platforms/refresh`
  (see [Refresh endpoint](#refresh-endpoint)) and the `npm run platforms:sync`
  command both drive the reconcile.
