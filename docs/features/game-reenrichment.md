---
type: Feature
title: Game Re-enrichment
description: POST /games/:id/enrich re-runs the IGDB → MobyGames → unresolved chain against a game's current title, returns the candidate, and applies fresh metadata in place without duplicating the record or overwriting protected/hand-edited fields.
tags: [api, enrichment, catalog, covers, provenance]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-07T11:50:00Z }
---

# Overview

A user can fix a game's title (or platform) after an import and then ask the
backend to look the game up again. `POST /games/:id/enrich` re-runs the same
[anti-hallucination chain](/anti-hallucination-validation.md) used by the import
pipeline — IGDB → MobyGames → unresolved — against the game's **current**
(corrected) title, returns the candidate, and on a second call with a picked
candidate applies fresh metadata to the **existing** row.

It reuses the one candidate→`Game` mapping introduced by
[Game Metadata Enrichment](/game-metadata-enrichment.md)
(`GameEnrichmentService.enrichCandidate`) and adds only a **merge policy** on
top — it never creates a duplicate and never wipes data.

# Endpoint

`POST /games/:id/enrich` — behind the global `SessionGuard` (no `@Public()`),
`@HttpCode(200)`. Path `id` is a `GameIdParamDto` (integer ≥ 1).

The body is optional and has two forms:

```jsonc
// 1. search — re-resolve and return the candidate(s); mutates nothing
{}

// 2. apply / pick — re-resolve, verify the pick, and merge fresh metadata
{ "candidate": { "source": "IGDB", "externalId": 1036 } }
```

`candidates` is an array (length 0 or 1 today — the resolver returns at most one
confident candidate), so the contract stays forward-compatible if the chain
later returns several.

Response (`EnrichGameResponseModel`):

```jsonc
{
  "status": "matched", // matched | unrecognized | transient | config_error
  "reason": null,
  "applied": false,
  "candidates": [
    {
      "source": "IGDB",
      "externalId": 1036,
      "title": "Halo: Combat Evolved",
      "releaseYear": 2001,
      "publisher": "Bungie",
      "genre": "Shooter",
      "playerCount": 16,
      "coverUrl": "/api/covers/preview?u=aHR0cHM6Ly9pbWFnZXMuaWdkYi5jb20v...&s=...",
      "platforms": [{ "igdbId": 11, "name": "Xbox", "abbreviation": "XBOX" }],
    },
  ],
  "game": {},
}
```

The archival `raw` upstream payload is never exposed; the candidate model drops
it (`toEnrichCandidateModel`). The candidate's external cover URL is also
replaced by a signed same-origin preview URL
([Local Cover Cache](/local-cover-cache.md)), so the external host never reaches
the browser.

# Status / error matrix

| Situation                                     | HTTP | Body / behaviour                                                      |
| --------------------------------------------- | ---- | --------------------------------------------------------------------- |
| search, matched                               | 200  | `status:"matched"`, `applied:false`, candidate returned, no write     |
| apply, matched (change written)               | 200  | `status:"matched"`, `applied:true`, game updated in place             |
| apply, matched (no change)                    | 200  | `status:"matched"`, `applied:false`, no write (idempotent)            |
| search/apply, unrecognized                    | 200  | `status:"unrecognized"`, `reason`, `candidates:[]`, no write          |
| apply, picked ≠ re-resolved candidate         | 409  | `The selected candidate is no longer available; run the search again` |
| transient                                     | 503  | `ServiceUnavailableException(reason)`, no write                       |
| config_error                                  | 503  | `ServiceUnavailableException(reason)`, no queue pause                 |
| unknown id                                    | 404  | `NotFoundException`                                                   |
| malformed body (unknown field, bad source, …) | 400  | global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`)        |

The pick is verified against a **fresh** re-resolution on the apply call, so a
stale pick (the chain now returns a different row) is a `409` rather than a
mis-applied write.

# Merge policy (never wipe, never touch identity)

`buildReenrichmentUpdate` (pure) turns the existing row and the freshly mapped
candidate into a `Prisma.GameUpdateInput`, or `null` when nothing changes:

1. `title`, `platformId`, and `edition` are **never emitted**. Re-enrichment
   cannot rename a game or move it to another platform/edition.
2. `releaseYear`, `publisher`, `genre`, `playerCount`: written only when the
   candidate provides a **non-null** value, the value differs, and the field is
   not hand-edited. A null candidate field leaves the existing value intact.
3. `coverUrl`: same rule (`/api/covers/<file>` via the shared cover cache). A
   candidate without a cover never clears an existing one. `sourceCoverUrl`
   (the external link, internal) is written when it differs too — even when the
   download failed — so the background sweep / `covers:redownload` can retry it
   ([Local Cover Cache](/local-cover-cache.md)).
4. `source` and `externalId` are written when they differ — this is what turns
   an unlinked `MANUAL` game into a linked one.
5. `platformUnverified` is set to `false` when it was `true`.
6. When nothing above changes → `null` (no write at all). `rawMetadata` and
   `enrichedAt` accompany a real change only, which makes a second identical
   apply byte-identical (record idempotency: `updatedAt`/`enrichedAt`/cover all
   unchanged).

Unlike the import create-path — where a missing source field is correctly
`null` on a fresh row — re-enrichment only fills or replaces.

# Provenance

`Game.userEditedFields` is a JSON array of hand-edited tracked metadata field
names (never queried, stored as text in `VarChar(255)`). The tracked set is
`releaseYear`, `publisher`, `genre`, `playerCount`, `coverUrl`
(`TRACKED_METADATA_FIELDS`); `title`/`platformId`/`edition` need no marker because
re-enrichment never touches them.

- `POST /games` and `PATCH /games/:id` mark every tracked field present in the
  request (explicit `null` counts as an edit) via `mergeEditedFields` /
  `serializeEditedFields`.
- Re-enrichment reads the set and skips any marked field (`buildReenrichmentUpdate`).
- `GameDetailModel.userEditedFields` is always an array, decoded by
  `toGameDetail` (`game-detail.mapper.ts`); `parseEditedFields` tolerates the raw
  Prisma string, an already-parsed array, and `null`/garbage (→ `[]`).

# Platform verification flag

`Game.platformUnverified` (boolean, default `false`) marks a game whose platform
could not be confidently confirmed. This ticket adds the column and its
**clearing** behavior (a `PATCH` that sets `platformId`, and a successful
re-enrichment). Nothing in the current codebase ever sets it `true`: the import
pipeline rejects an unresolvable platform and creates no `Game`. Setting it is
out of scope.

# Data model

Migration `20261007094108_add_game_reenrichment_fields` adds three columns to
`games` (existing rows get `NULL`/`false`/`NULL`; no backfill):

```sql
ALTER TABLE `games` ADD COLUMN `external_id` INTEGER NULL,
    ADD COLUMN `platform_unverified` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `user_edited_fields` VARCHAR(255) NULL;
```

`externalId` is the upstream row id paired with `source` (IGDB/MobyGames); the
import create-path now writes it too (additive). `rawMetadata` remains archival.

# Tests

- `reenrichment.spec.ts` (unit): `buildReenrichmentUpdate` returns `null` when
  nothing changes; fills nulls but never nulls existing; respects hand-edited
  fields; never emits `title`/`platformId`/`edition`; replaces/keeps/never
  overwrites the cover; sets `source`+`externalId`; clears `platformUnverified`;
  appends `rawMetadata`+`enrichedAt` only on a change; parse/serialize/merge
  round-trips and tolerates `null`/garbage.
- `games.service.spec.ts` (unit): the `enrich` describe covers search-matched,
  apply-matched, unrecognized, transient/config_error → 503, stale pick → 409,
  idempotent no-op, hand-edited preservation, and 404; plus the create/update
  provenance and `platformUnverified` behavior.
- `game-reenrichment.e2e-spec.ts` (e2e): re-resolve a corrected title and apply
  fresh metadata with no duplicate and protected fields unchanged; the candidate
  cover is a same-origin preview with no external host; `sourceCoverUrl` is
  persisted; still-unresolved leaves metadata intact; hand-edited publisher
  survives; a changed cover replaces the cached one and the replaced file is
  unlinked; a failed re-enrichment download does not clobber the existing cover;
  `PATCH` and re-enrichment clear `platformUnverified`; an unlinked `MANUAL` game
  becomes linked; a second identical apply writes nothing; and the
  404/400/503/409 error matrix.

# Out of scope

- Setting `platformUnverified = true` (only the clearing behavior is added).
- Clearing provenance (`userEditedFields` is only ever unioned).
- Frontend UI for the search/pick flow.

Cover thumbnails, background retry, the re-download CLI, and ref-counted orphan
cleanup are specified in [Local Cover Cache](/local-cover-cache.md).
