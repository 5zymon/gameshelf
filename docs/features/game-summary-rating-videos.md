---
type: Feature
title: Game Summary, Rating & YouTube Videos
description: IGDB enrichment adds a game's English description (summary), its 0–100 user rating (shown on the catalog grid and the detail page), and its YouTube videos, which the detail page embeds click-to-play from a scoped CSP frame-src exception.
tags: [api, enrichment, igdb, web, ui, csp]
status: draft
generated: { by: opencode/home-model, at: 2026-10-11T10:00:00Z }
---

# Overview

Card 9.1 enriches a saved game with three more IGDB fields beyond the
[metadata](game-metadata-enrichment.md) already mapped:

1. **`summary`** — IGDB's English description (never translated), shown as the
   detail page's "Description" section and **hand-editable** like
   publisher/genre.
2. **`rating`** (and its `ratingCount`) — IGDB's 0–100 **user-rating average**
   (not the critic `aggregated_rating`), shown as a `78/100` label on the
   [catalog grid](catalog-grid.md) tiles and as a "Rating" row on the detail
   page. Source-derived only; never hand-edited.
3. **`videos`** — IGDB's YouTube videos, in IGDB order, embedded on the detail
   page by a **click-to-play** player.

It reuses the one candidate→`Game` mapping
([Game Metadata Enrichment](game-metadata-enrichment.md)) and the
[re-enrichment merge policy](game-reenrichment.md); the only new surface is the
`game_videos` table, the three `games` columns, and the web presentation.

The videos player is the **single sanctioned exception** to the
[strict single-origin CSP](single-origin-frontend-api.md): the detail page
embeds `https://www.youtube.com/embed/<id>`, so the policy gains the YouTube
hosts and a `frame-src` directive, plus the `https://i.ytimg.com` thumbnail host
in `img-src`. The player's facade fetches the video thumbnail from YouTube at
render; the embed `<iframe>` loads only after the user presses play.

# Data model

Migration `20261011090000_add_game_summary_rating_videos`:

```sql
ALTER TABLE `games` ADD COLUMN `summary` TEXT NULL,
    ADD COLUMN `rating` DOUBLE NULL,
    ADD COLUMN `rating_count` INTEGER NULL;

CREATE TABLE `game_videos` (
    `id` CHAR(36) NOT NULL,
    `game_id` CHAR(36) NOT NULL,
    `position` INTEGER NOT NULL,
    `video_id` VARCHAR(32) NOT NULL,
    `name` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `game_videos_game_id_position_key`(`game_id`, `position`),
    INDEX `game_videos_game_id_idx`(`game_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `game_videos` ADD CONSTRAINT `game_videos_game_id_fkey`
    FOREIGN KEY (`game_id`) REFERENCES `games`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
```

`id` and `game_id` are UUIDv7 `CHAR(36)` today: [ADR-006](adr-006-uuidv7-primary-keys.md)
later replaced every non-singleton auto-increment key (and its foreign keys)
with an app-generated UUIDv7, so the excerpt above shows the current shape, not
the migration's original `INTEGER` DDL.

`GameVideo` mirrors [GameImage](game-image-gallery.md): one row per video, FK
cascade, `position` = display order (IGDB order), `@@unique([gameId, position])`,
index on `gameId`. `videoId` is the validated YouTube id; `name` is nullable
(IGDB sometimes omits it). Existing rows get `summary`/`rating`/`rating_count`
`NULL` and no videos (no backfill).

# IGDB mapping

`IGDB_GAME_FIELDS` (see [IGDB Client & Rate Limiter](igdb-client.md)) already
requested `summary`; it now also requests
`rating,rating_count,videos.id,videos.name,videos.video_id`. It deliberately does
**not** request `aggregated_rating` (the critic aggregate) — GameShelf uses the
user-rating `rating`.

`IgdbGameCatalogResolver.toCandidate` maps the new fields onto the
`CatalogCandidate`:

- **`summary`** — `nonBlank(game.summary)`: the original text passes through
  unchanged when non-blank, else `null`. It is capped at **16000 characters**
  (`slice(0, 16000)`): the column is `TEXT` (65535 bytes under utf8mb4), so a
  pathological longer summary would otherwise fail the insert.
- **`rating`** — `igdbRating(game.rating)`: the value only when it is a finite
  number in `[0, 100]`, else `null` (an out-of-range or missing rating is never
  invented, and `0` is a real rating, not a placeholder).
- **`ratingCount`** — `nonNegativeInt(game.rating_count)`: a non-negative integer,
  else `null`.
- **`videos`** — `youtubeVideos(game.videos)`: IGDB order is kept; each entry
  keeps only a valid YouTube id (`^[A-Za-z0-9_-]{11}$`), is deduped by id, and
  its `name` is `nonBlank(...)` trimmed to 255 chars (`null` when missing/blank).
  A malformed id is dropped, never embedded.

`CatalogCandidate.summary`/`rating`/`ratingCount`/`videos` are optional, so a
source without them (MobyGames) contributes nothing.

# Write paths

`mapCandidateToGameData` writes the new scalars (`summary`/`rating`/`ratingCount`
via `?? null`) and `videos` (`?? []`). `toGameCreateData` nests the ordered
`videos.create` alongside `images.create`, keeping the flat `EnrichedGameData`
usable for the re-enrichment merge.

## Create paths

Manual linked add and the import commit both go through
`GameEnrichmentService.enrichCandidate` → `toGameCreateData`, so a freshly
created game stores the candidate's summary, rating, ratingCount and videos.

## Re-enrichment merge

`buildReenrichmentUpdate` (see [Game Re-enrichment](game-reenrichment.md))
extends the never-wipe policy:

- `summary`: written only when the candidate provides a **non-null** value, it
  **differs**, and the field is not hand-edited.
- `rating` / `ratingCount`: written when the candidate provides a non-null value
  that differs. They are **source-derived only** (not hand-editable), so they are
  refreshed even for a hand-edited summary, but an unrated candidate never wipes
  a stored rating.
- `videos`: replaced (`deleteMany` + ordered `create`) only when the candidate
  supplies a **non-empty** list whose ordered `videoId`+`name` pairs differ.
  An empty candidate list never wipes the stored videos, and an identical list
  writes nothing (`sameOrderedVideos`), so the whole update stays idempotent.

`rawMetadata` and `enrichedAt` still accompany a real change only.

# Provenance

`summary` is added to `TRACKED_METADATA_FIELDS` (now
`releaseYear`, `publisher`, `genre`, `playerCount`, `coverUrl`, `summary`). A
`POST /games` or `PATCH /games/:id` that includes `summary` (an explicit `null`
counts) marks it hand-edited, and re-enrichment then skips it. `rating`,
`ratingCount` and `videos` are **not** tracked: they are source-derived and
cannot be hand-edited.

# API surface

- **List.** `GET /games` selects `rating` (`GAME_LIST_SELECT`), so
  `GameListItem.rating` is `number | null` (`null` = unrated).
- **Detail.** `GET /games/:id` returns `summary`, `rating`, `ratingCount` and the
  ordered `videos` (`{ id, name, videoId }`, by `position`). `summary`/`rating`/
  `ratingCount` are plain `Game` columns; `videos` is included via
  `GAME_DETAIL_INCLUDE`.
- **Candidates.** `toEnrichCandidateModel` drops `summary`, `rating`,
  `ratingCount` and `videos` from `POST /games/search` and `POST /games/:id/enrich`
  candidates — card 9.1 exposes them on the **game**, not on the candidate, so the
  candidate shape is unchanged.
- **Write.** `CreateGameDto` gains an optional `summary` (`@IsString`,
  `@MaxLength(16000)`); `UpdateGameDto` inherits it via `PartialType`, so `PATCH`
  can set or clear it. `rating`/`ratingCount`/`videos` are never client-writable.

# Web UI

- **Grid rating.** `GameCard` renders the `formatRating(game.rating)` label
  (`78/100`, rounded; `null` when absent) as a small badge on the cover and
  includes it in the tile's `aria-label`. `apps/web/src/lib/rating.ts` clamps to
  `[0, 100]` and rounds.
- **Detail description & rating.** `GameDetailView` renders a "Description"
  section from `game.summary` (whitespace-pre-line, with a "hand-edited" marker
  when `summary` is in `userEditedFields`) and a "Rating" row.
- **Detail videos.** `GameVideos` (`apps/web/src/components/game-videos.tsx`)
  shows a **thumbnail facade** until the user presses Play or picks a video: the
  video's YouTube poster (`i.ytimg.com`, `maxresdefault.jpg` with an `hqdefault`
  fallback) sits behind a scrim with a play glyph, and no `<iframe>` is mounted
  until Play — then the `https://www.youtube.com/embed/<id>?autoplay=1` iframe
  takes over. The thumbnail alone is fetched from YouTube at render. A text-only
  switcher (translated labels) appears when there is more than one playable
  video. The component renders nothing when there are no valid ids.
  `apps/web/src/lib/youtube.ts` holds the id validation (`isYoutubeVideoId`),
  `youtubeEmbedUrl`, `youtubeThumbnailUrl`, and `playableVideos`.
- **Edit.** `GameEditForm` adds a "Description" `<textarea>` (`maxLength=16000`).
  `multilineDelta` compares newline-normalized, trimmed text, so an untouched
  IGDB summary is not marked hand-edited just because a textarea normalizes CRLF
  to LF.
- **i18n.** New PL/EN strings under `gameDetail.field.rating`, `gameDetail.summary`,
  `gameDetail.videos.*` and `gameEdit.field.summary`, kept in parity by the
  messages test.

# Content Security Policy

`apps/web/src/lib/csp.ts` centralises the policy (the middleware imports it) and
defines `YOUTUBE_EMBED_SOURCES = ['https://www.youtube.com',
'https://player.youtube.com']`, added to `script-src` and a new `frame-src`
directive (`frame-src 'self' https://www.youtube.com
https://player.youtube.com`). `YOUTUBE_THUMBNAIL_SOURCES =
['https://i.ytimg.com']` is added to `img-src` only
(`img-src 'self' blob: https://i.ytimg.com`) so the facade can fetch each video's
thumbnail at render — a deliberate extension of the card-9.1 exception that
relaxes its old "only while a video is playing" wording; every other fetch
directive stays `'self'`. Under `'strict-dynamic'`, CSP3 browsers ignore the host
entries in `script-src` — the player's scripts run inside the iframe's own
document, which our policy does not govern — but the card asks for them. See
[Single-Origin Frontend & API with Strict CSP](single-origin-frontend-api.md)
for the full directive table and the external-request caveat.

# Tests

- `igdb-game-catalog.resolver.spec.ts` (unit): the real IGDB fixture maps to the
  summary/rating/ratingCount/videos; invalid video ids are dropped, duplicates
  removed and IGDB order kept; a missing/blank video name stays `null`; an
  out-of-range/non-finite rating becomes `null`; a blank summary becomes `null`
  and an over-long one is capped at 16000.
- `igdb.client.spec.ts` (unit): the games query requests `rating`, `rating_count`
  and `videos.*` and never `aggregated_rating`.
- `game-enrichment.service.spec.ts` (unit): the nested `videos.create` keeps
  videos out of the top-level scalars; missing fields stay `null`/`[]`.
- `reenrichment.spec.ts` (unit): a hand-edited summary is preserved while the
  rating is refreshed; a changed summary is written; `null`/empty candidate
  values never wipe summary/rating/ratingCount/videos; videos are replaced when
  the order or a name differs.
- `game-detail.mapper.spec.ts` (unit): the detail exposes summary/rating/
  ratingCount and the ordered videos; the list rating passes through.
- `games.service.spec.ts` (unit): the create/update paths write the summary and
  mark it hand-edited; enrich candidates drop summary/rating/ratingCount/videos.
- `catalog-validation.e2e-spec.ts`, `games-manual-add.e2e-spec.ts`,
  `game-reenrichment.e2e-spec.ts` (e2e): a real pipeline run stores the summary/
  rating/videos in IGDB order; a picked manual-add candidate stores them; a
  re-enrichment applies them, keeps a hand-edited summary while refreshing the
  rating, and the candidate bodies carry none of the four keys.
- `games.e2e-spec.ts` (e2e): `GET /games` items carry the rating (and `null` when
  unrated).
- Web (`node --test`): `rating.test.mjs` (rounding, clamping, non-finite → no
  label), `youtube.test.mjs` (id validation, embed URL, thumbnail URL,
  `playableVideos`), and `csp.test.mjs` (the YouTube hosts in `script-src`,
  `frame-src` and the thumbnail host in `img-src`, and the dev/prod
  differences).

# Out of scope

- Translating the description or the video names (IGDB text is English).
- A manual gallery/video editor — both are source-derived and cannot be edited.
- Backfilling summary/rating/videos for rows saved before this change; they
  appear on the next re-enrichment.
- Choosing `aggregated_rating` (the critic aggregate) — only the user rating.
