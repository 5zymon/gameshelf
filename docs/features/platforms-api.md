---
type: Feature
title: Platforms API
description: Platform CRUD (GET/POST/PATCH/DELETE /platforms) with per-platform game counts and the canonical IGDB platform seed.
tags: [api, platforms, catalog]
status: stable
generated: { by: opencode/home-model, at: 2026-10-05T16:44:00Z }
---

# Overview

The platforms API manages the catalog's platform reference list (spec §4.6):
list, create, rename, and delete platforms. Every response carries the
platform's `gameCount`, so the platforms view can show how many games sit on
each platform without extra requests. The canonical IGDB platform list is
loaded once as a committed seed data-migration and can be regenerated with a
documented script (see [Canonical platform list](#canonical-platform-list)).

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
  "igdbId": 130,
  "slug": "playstation-5",
  "gameCount": 12
}
```

`abbreviation`, `alternativeName`, and `igdbId` are `null` for custom
platforms and for canonical platforms that IGDB does not carry those fields
for.

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
(`abbreviation`, `alternativeName`, `igdbId`) — the IGDB integration (ticket
4.2) writes its matching results through this endpoint. An explicit `null`
clears a field; omitting it leaves it untouched.

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
- Slugs are **never rewritten afterwards** — neither rename nor the seed
  migration touches them, so a stable slug survives renames and re-seeds.

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

Decision (settles the platform-list open question in ADR-003): the canonical
IGDB platform list is loaded by a **committed seed data-migration**, not by a
lazy first-run load. Rationale: the list is reference data that every
environment (dev, CI, production) must have identically, and a committed
migration is reviewable, repeatable, and visible in `migrate deploy`.

- Seed: `apps/api/prisma/migrations/<ts>_seed_igdb_platforms/migration.sql` —
  one idempotent `INSERT … ON DUPLICATE KEY UPDATE` per platform, keyed on
  the unique `name` (ci collation). The `UPDATE` clause refreshes
  `abbreviation`, `alternative_name`, and `igdb_id` but **never `slug`**, so
  existing custom slugs survive a re-seed. The initial seed migration is
  generated and committed once IGDB credentials are available (the script
  above is the single source for its content).
- Regenerate: `npm run db:platforms:fetch`
  (`apps/api/prisma/igdb-platforms.mjs`) fetches
  `https://api.igdb.com/v4/platforms` (fields `name`, `abbreviation`,
  `alternative_name`, `slug`; paginated at 500) using
  `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` from the repo-root `.env`, and
  prints the migration SQL to stdout. Commit it as a new migration:

  ```sh
  ts=$(date -u +%Y%m%d%H%M%S)
  mkdir -p "apps/api/prisma/migrations/${ts}_seed_igdb_platforms"
  npm run db:platforms:fetch --silent > "apps/api/prisma/migrations/${ts}_seed_igdb_platforms/migration.sql"
  npm run db:migrate
  ```

- The spec's "refresh from Settings" (§4.6.1) is a later-stage concern: the
  refresh endpoint will re-run this same fetch-and-upsert flow, so the seed
  migration is the canonical format it writes.

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
- **The Settings "refresh platforms" endpoint** — later stage (see
  [Canonical platform list](#canonical-platform-list)).
