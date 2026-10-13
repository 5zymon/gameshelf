---
type: Feature
title: Game Re-enrichment
description: POST /games/:id/enrich searches the catalog through the IGDB-first search seam (ranked list, best first, up to 10; MobyGames only when IGDB returns no candidates) against a game's current title, and applies any picked candidate's fresh metadata in place without duplicating the record or overwriting protected/hand-edited fields.
tags: [api, enrichment, catalog, covers, provenance]
status: draft
generated: { by: opencode/home-model, at: 2026-10-10T19:55:01Z }
---

# Overview

A user can fix a game's title (or platform) after an import and then ask the
backend to look the game up again. `POST /games/:id/enrich` searches the catalog
through the **search seam** (`GameCatalogResolver.search`, the same ranked list
`GET /games/search` uses) against the game's **current** (corrected) title and
returns the **ranked candidate list** (best match first, up to
`CATALOG_SEARCH_MAX_RESULTS` = 10). The seam is **IGDB-first**: IGDB's candidates
are returned first and [MobyGames](/mobygames-fallback.md) is consulted **only
when IGDB returns no candidates at all**. On a second call with a picked
candidate it applies that candidate's fresh metadata to the **existing** row.

Unlike re-enrichment, the [import pipeline](/anti-hallucination-validation.md)
keeps its stricter single-candidate `resolve()` rule (`selectConfidentMatch`,
score ≥ 0.8): it never offers a list and rejects a weak match.

It reuses the one candidate→`Game` mapping introduced by
[Game Metadata Enrichment](/game-metadata-enrichment.md)
(`GameEnrichmentService.enrichCandidate`) and adds only a **merge policy** on
top — it never creates a duplicate and never wipes data.

# Endpoint

`POST /games/:id/enrich` — behind the global `SessionGuard` (no `@Public()`),
`@HttpCode(200)`. Path `id` is a `GameIdParamDto` (a UUIDv7 string).

The body is optional and has two forms:

```jsonc
// 1. search — return the ranked candidate list; mutates nothing
{}

// 2. apply / pick — re-run the search, verify the pick, and merge fresh metadata
{ "candidate": { "source": "IGDB", "externalId": 1036 } }
```

The search step delegates to the catalog search seam (`GameCatalogResolver.search`,
the same ranked list `GET /games/search` uses), which returns every candidate
with a positive match score, best first, capped at
`CATALOG_SEARCH_MAX_RESULTS` (10). `candidates` is therefore a **ranked list**
(possibly empty); the user picks any entry to disambiguate a weak or ambiguous
title. A search that returns **no candidates at all** reports `unrecognized`
(with a `reason`) — this is not a score threshold: any positive-score IGDB hit
is shown as a selectable candidate. The import pipeline keeps its stricter
single-candidate rule (`selectConfidentMatch`, score ≥ 0.8) — only re-enrichment
is list-based.

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

| Situation                                                  | HTTP | Body / behaviour                                                              |
| ---------------------------------------------------------- | ---- | ----------------------------------------------------------------------------- |
| search, matched                                            | 200  | `status:"matched"`, `applied:false`, ranked candidate list returned, no write |
| apply, matched (change written)                            | 200  | `status:"matched"`, `applied:true`, game updated in place                     |
| apply, matched (no change)                                 | 200  | `status:"matched"`, `applied:false`, no write (idempotent)                    |
| search/apply, no candidates at all                         | 200  | `status:"unrecognized"`, `reason`, `candidates:[]`, no write                  |
| apply, picked candidate absent from a non-empty fresh list | 409  | `The selected candidate is no longer available; run the search again`         |
| transient                                                  | 503  | `ServiceUnavailableException(reason)`, no write                               |
| config_error                                               | 503  | `ServiceUnavailableException(reason)`, no queue pause                         |
| unknown id                                                 | 404  | `NotFoundException`                                                           |
| malformed body (unknown field, bad source, …)              | 400  | global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`)                |

The pick is verified against a **fresh** search on the apply call, so a stale
pick is a `409` rather than a mis-applied write. This applies only when the
fresh list is **non-empty**; when the fresh search returns **no candidates at
all** the apply reports `200 unrecognized` (nothing is available to apply).
**Any** candidate in a non-empty fresh list is applicable, not only the
top-ranked one.

# Merge policy (never wipe, never touch identity)

`buildReenrichmentUpdate` (pure) turns the existing row and the freshly mapped
candidate into a `Prisma.GameUpdateInput`, or `null` when nothing changes:

1. `title`, `platformId`, and `edition` are **never emitted**. Re-enrichment
   cannot rename a game or move it to another platform/edition.
2. `releaseYear`, `publisher`, `genre`, `playerCount`, `summary`: written only
   when the candidate provides a **non-null** value, the value differs, and the
   field is not hand-edited. A null candidate field leaves the existing value
   intact. (`summary` is the new hand-editable, provenance-tracked description;
   see [Game Summary, Rating & YouTube Videos](/game-summary-rating-videos.md).)
3. `rating` and `ratingCount`: written when the candidate provides a non-null
   value that differs. They are **source-derived only** (not hand-editable), so
   they are refreshed even for a hand-edited summary, and an unrated candidate
   never wipes a stored rating.
4. `videos`: replaced (`deleteMany` + ordered `create`) only when the candidate
   supplies a **non-empty** list whose ordered `videoId`+`name` pairs differ
   (`sameOrderedVideos`). An empty candidate list never wipes the stored videos,
   and an identical list writes nothing.
5. `coverUrl`: same rule as item 2 (`/api/covers/<file>` via the shared cover
   cache). A candidate without a cover never clears an existing one.
   `sourceCoverUrl` (the external link, internal) is written when it differs too
   — even when the download failed — so the background sweep /
   `covers:redownload` can retry it ([Local Cover Cache](/local-cover-cache.md)).
6. `source` and `externalId` are written when they differ — this is what turns
   an unlinked `MANUAL` game into a linked one.
7. `platformUnverified` is set to `false` when it was `true`.
8. `igdbSlug` is written when it differs from the candidate's IGDB `slug`
   (`Game.igdbSlug`, nullable). It is internal: it never appears in a response
   body, and the API derives `igdbUrl` from it (`igdbUrlFor` in
   `apps/api/src/games/game-detail.mapper.ts`); the detail view only renders the
   returned `igdbUrl`. Games enriched before
   the slug was stored keep `igdbSlug = NULL` (no backfill) until re-enriched.
9. When nothing above changes → `null` (no write at all). `rawMetadata` and
   `enrichedAt` accompany a real change only, which makes a second identical
   apply byte-identical (record idempotency: `updatedAt`/`enrichedAt`/cover all
   unchanged).

Unlike the import create-path — where a missing source field is correctly
`null` on a fresh row — re-enrichment only fills or replaces.

# Provenance

`Game.userEditedFields` is a JSON array of hand-edited tracked metadata field
names (never queried, stored as text in `VarChar(255)`). The tracked set is
`releaseYear`, `publisher`, `genre`, `playerCount`, `coverUrl`, `summary`
(`TRACKED_METADATA_FIELDS`); `title`/`platformId`/`edition` need no marker because
re-enrichment never touches them, and `rating`/`ratingCount`/`videos` are
source-derived only.

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
re-enrichment). The photo-import **create path** now sets it `true` when the
platform was chosen by the catalog fallback (`resolvePlatformId` provenance
`'catalog'` — the photo gave no usable platform) and `false` when it came from
the photo (provenance `'photo'`). The import pipeline still rejects a title with
_no usable platform name at all_ (`platform_not_in_catalog`) and creates no
`Game` in that case. This doc's clearing behavior (a `PATCH` that sets
`platformId`, and a successful re-enrichment) is unchanged.

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
  fields (including a hand-edited `summary`, while still refreshing the rating);
  never emits `title`/`platformId`/`edition`; replaces/keeps/never overwrites the
  cover; sets `source`+`externalId`; clears `platformUnverified`; refreshes
  `rating`/`ratingCount` but never wipes them with `null`; replaces videos only
  when the ordered id+name list differs; appends `rawMetadata`+`enrichedAt` only
  on a change; parse/serialize/merge round-trips and tolerates `null`/garbage.
- `games.service.spec.ts` (unit): the `enrich` describe covers search-matched
  (single **and** the full ranked multi-candidate list, order preserved),
  apply-matched (first **and** a non-first candidate), unrecognized,
  transient/config_error → 503, stale pick → 409, idempotent no-op, hand-edited
  preservation, and 404; plus the create/update provenance and
  `platformUnverified` behavior.
- `game-reenrichment.e2e-spec.ts` (e2e): a search returns the ranked candidate
  list (multiple, best first, each cover a same-origin preview, no `raw`); a
  non-first candidate applies without touching identity fields; re-resolve a
  corrected title and apply fresh metadata with no duplicate and protected
  fields unchanged; the candidate cover is a same-origin preview with no
  external host; `sourceCoverUrl` is
  persisted; still-unresolved leaves metadata intact; hand-edited publisher
  survives; a changed cover replaces the cached one and the replaced file is
  unlinked; a failed re-enrichment download does not clobber the existing cover;
  applies the candidate's summary/rating/ratingCount/videos (videos in IGDB
  order); keeps a hand-edited summary while refreshing the rating; `PATCH` and
  re-enrichment clear `platformUnverified`; an unlinked `MANUAL` game
  becomes linked; a second identical apply writes nothing; and the
  404/400/503/409 error matrix.

# Out of scope

- Clearing provenance (`userEditedFields` is only ever unioned).
- Frontend presentation of the search/pick flow lives in the
  [Game Detail View](/game-detail.md) doc (`ReEnrichControl`).

Cover thumbnails, background retry, the re-download CLI, and ref-counted orphan
cleanup are specified in [Local Cover Cache](/local-cover-cache.md).
