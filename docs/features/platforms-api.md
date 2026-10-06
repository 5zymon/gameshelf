---
type: Feature
title: Platforms API
description: Platform CRUD (GET/POST/PATCH/DELETE /platforms) with per-platform game counts and the canonical IGDB platform list reconciled locally by an operator sync command.
tags: [api, platforms, catalog]
status: stable
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-06T14:49:32Z }
---

# Overview

The platforms API manages the catalog's platform reference list (spec §4.6):
list, create, rename, and delete platforms. Every response carries the
platform's `gameCount`, so the platforms view can show how many games sit on
each platform without extra requests. The canonical IGDB platform list is
**fetched once and stored locally** by an operator-run sync command
(`npm run platforms:sync`), not by a committed seed migration; per-game imports
read the local table only (see
[Canonical platform list](#canonical-platform-list)).

# Endpoint contract

| Method   | Path             | Purpose                                                                 | Success                 | Errors              |
| -------- | ---------------- | ----------------------------------------------------------------------- | ----------------------- | ------------------- |
| `GET`    | `/platforms`     | All platforms with a `gameCount` each, sorted by name (ci)              | `200` `PlatformModel[]` | —                   |
| `GET`    | `/platforms/:id` | One platform by id, with `gameCount`                                    | `200` `PlatformModel`   | `400`, `404`        |
| `POST`   | `/platforms`     | Create a platform (slug is generated)                                   | `201` `PlatformModel`   | `400`, `409`        |
| `PATCH`  | `/platforms/:id` | Rename a platform (slug is kept); optionally set/clear canonical fields | `200` `PlatformModel`   | `400`, `404`, `409` |
| `DELETE` | `/platforms/:id` | Delete a platform — refused while games reference it                    | `204` (no body)         | `400`, `404`, `409` |

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
  "gameCount": 12
}
```

`abbreviation`, `alternativeName`, `platformFamily`, and `igdbId` are `null`
for custom platforms and for canonical platforms that IGDB does not carry those
fields for. `platformFamily` is IGDB's platform-family reference id, stored
faithfully and not used for matching.

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

# Delete behaviour

A platform that still has games **cannot be deleted** (spec §4.6.5: "A
platform that has games cannot be deleted — its games must be reassigned
first"). `DELETE /platforms/:id` therefore:

1. Returns `404` if the platform does not exist.
2. Counts the platform's games; if the count is greater than zero, returns
   `409` with a message naming the count — nothing is deleted
   (non-destructive).
3. Otherwise deletes and returns `204`.

The foreign key `games.platform_id → platforms.id` is `ON DELETE RESTRICT`,
which is the backstop for the race where a game appears between the count and
the delete: the delete then fails with a FK violation (`P2003`) and the API
maps it to the same `409`.

# Rename semantics

`PATCH /platforms/:id` takes a required `name` plus optional canonical fields
(`abbreviation`, `alternativeName`, `igdbId`). An explicit `null` clears a
field; omitting it leaves it untouched. (The sync command writes the canonical
link directly through `PlatformsSyncService`, not through this endpoint.)

- The rename changes only the displayed name. **The slug is never rewritten**
  (spec §4.6.4), so `slug` is stable across renames and existing game rows
  are untouched (the FK is on `id`, not `name` or `slug`).
- Renaming a platform to its own current name is a `200` no-op, not a `409`.
- Renaming to another platform's name is a `409` (case-insensitive, as above).
- Renaming an unknown id is a `404`.

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

## Matching rules

`findPlatformMatch` (`apps/api/src/platforms/platform-match.ts`) is the single
matcher shared by the sync command and the per-game import:

- **Anchored equality only**, applied to whole normalized
  names/abbreviations/alternative names — no fuzzy or containment matching, so
  `PlayStation 4` never force-matches `PlayStation 5`.
- Normalization is case-, diacritic-, punctuation-, and whitespace-insensitive
  (`Święta` → `swieta`, `PlayStation-5` → `playstation 5`) and expands `&` to
  `and`.
- The first input whose key is known wins (candidate order is respected).
- A key shared by two distinct platform ids is treated as **ambiguous** and
  never matched; blank keys are skipped.
- An unknown platform is created by the sync; a per-game import never creates
  one.

Because the list is stored locally, per-game imports make **zero**
platform-list calls: `resolvePlatformId` reads the local `platforms` table (in
one query) and then matches — it never fetches IGDB.

The spec's "refresh from Settings" (§4.6.1) is a later-stage concern; the
documented refresh today is `npm run platforms:sync`. When the endpoint is
built it will re-run this same reconcile flow.

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

- **Merging platforms** (spec §4.6.4) — a later ticket; the API currently has
  no merge endpoint.
- **Reassigning games between platforms** — done via the games API
  ([Catalog API](/catalog-api.md)); this API only refuses deletes that would
  orphan games.
- **The "added by import" review flow** (spec §4.6.6) — a Stage 4 import
  concern.
- **The platforms view** (counts + toggle for all reference platforms) —
  frontend; this API serves the data it needs.
- **The Settings "refresh platforms" endpoint** — later stage; today's
  documented refresh is the `npm run platforms:sync` command (see
  [Canonical platform list](#canonical-platform-list)).
