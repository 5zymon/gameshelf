---
type: Feature
title: Game Image Gallery & High-Resolution Covers
description: IGDB covers rewritten to t_1080p, plus a locally cached screenshots/artworks gallery persisted per game and shown in an accessible lightbox on the detail page.
tags: [covers, images, igdb, gallery, ui, enrichment]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-09T08:48:08Z }
---

# Overview

Two related improvements to catalog imagery, for **newly created and manually
re-enriched** games only:

1. **High-resolution covers.** An IGDB cover is no longer stored at the
   `t_thumb` size; the `t_thumb` segment of the `cover.url` is rewritten to
   `t_1080p` by one central helper.
2. **Per-game gallery.** IGDB `screenshots` and `artworks` are downloaded into
   the [Local Cover Cache](/local-cover-cache.md) and persisted as an ordered
   gallery on the game. The [Game Detail View](/game-detail.md) renders the
   gallery as a thumbnail strip that opens an accessible lightbox.

Both are source-derived only: the gallery is never hand-edited and no bulk
backfill exists. Existing rows keep their `t_thumb` cover and have no gallery
until they are re-enriched.

# Cover size rewrite

`igdbImageUrl(url, size)` (`apps/api/src/game-catalog/igdb-image-url.ts`) is the
one place that rewrites an IGDB image URL:

- a protocol-relative `//images.igdb.com/...` URL becomes `https://...`;
- an existing `t_*` size segment is replaced (`t_thumb`/`t_original`/`t_cover_big`
  → `t_1080p`);
- a URL with no size segment (`/upload/co61gh.jpg`) gets one inserted
  (`/upload/t_1080p/co61gh.jpg`);
- a non-IGDB-transform URL (no `/upload/`) is returned unchanged, and
  `null`/blank input returns `null`. The helper never throws.

`IGDB_IMAGE_SIZE` (`t_1080p`) is the size constant in `igdb.options.ts`. It is
applied by the IGDB resolver to the cover **and** to every gallery URL, so the
whole feature shares one size seam.

# Gallery source & ordering

The IGDB query (`IGDB_GAME_FIELDS` in `igdb.client.ts`) adds `screenshots.url`
and `artworks.url`; `IgdbGame` models both. `IgdbGameCatalogResolver.galleryImages`
normalizes every URL with `igdbImageUrl`, dedupes by resolved URL, orders
**artworks first** (purpose-made key art) then **screenshots** (gameplay
context), each in IGDB order, and caps the list at `IGDB_GALLERY_MAX_IMAGES`
(8).

`CatalogCandidate` gains `images: string[]`. IGDB populates it; MobyGames always
returns `[]` (a MobyGames gallery is out of scope). The candidate response model
(`toEnrichCandidateModel`) strips `images` like `raw`, so the external gallery
URLs never reach the browser.

# Local caching & serving

`GameEnrichmentService.enrichCandidate` downloads the cover and every gallery
image through the same `CoverCacheService.cacheFromUrl` seam (same host
allowlist, 5 MB cap, and timeout as covers). It runs the cover and gallery
downloads concurrently; a failed gallery download is dropped silently. The
result is a `GalleryImageInput[]` of local `/api/covers/<file>` paths plus the
internal `sourceUrl`.

`cacheFromUrl` already calls `ensureThumbnail`, so every gallery image also gets
a 300 px WebP thumbnail. Grid thumbnails use `/api/covers/thumbs/<file>`; the
lightbox uses the full cached `/api/covers/<file>` (`t_1080p`). Nothing is ever
hotlinked.

# Persistence

A new `GameImage` model (`game_images` table, migration
`20261009083327_add_game_images`) holds one row per gallery image: `gameId` FK
(cascade delete), `position` (display order), `url` (the same-origin served
path), optional `sourceUrl` (external IGDB URL, internal, never serialized), and
timestamps, with `@@unique([gameId, position])` and an index on `gameId`.

`Game.rawMetadata` is untouched. `images` is **not** a tracked metadata field
(`TRACKED_METADATA_FIELDS` is `releaseYear/publisher/genre/playerCount/coverUrl/summary`),
because the gallery is source-derived and cannot be hand-edited.

Writes:

- **Create paths** (manual linked add, import commit) use
  `toGameCreateData(enriched)`, which nests the ordered `images.create`.
- **Manual re-enrichment** merges through
  [Game Re-enrichment](/game-reenrichment.md): the gallery is replaced
  (`deleteMany` + ordered `create`) only when the candidate supplies a
  **non-empty** gallery whose ordered URLs differ. An empty candidate gallery
  never wipes the stored one, and an identical order writes nothing (so the
  whole update stays idempotent).

Orphan cleanup extends `CoverMaintenanceService.removeIfUnreferenced`: a file is
deleted only when neither a `Game.coverUrl` nor a `GameImage.url` still
references it. Replaced gallery files are removed on re-enrichment, and all
gallery files are removed on game delete and on a duplicate import.

# Detail UI (lightbox a11y)

`GET /games/:id` returns `images[]` with `url` + `thumbUrl`, mapped through an
explicit Prisma select (`GAME_DETAIL_INCLUDE`, ordered by `position`).
`GameListItem` is unchanged (the list stays cover-only). The web `GameGallery`
(`'use client'`) renders a thumbnail strip inside the detail page's **Media**
tab; clicking a thumbnail opens a modal lightbox:

- `role="dialog"`, `aria-modal="true"`, translated `aria-label` and alt text;
- Escape closes; `ArrowLeft`/`ArrowRight` navigate (wrapping);
- Tab is trapped between the dialog's buttons, and focus is restored to the
  opener on close;
- backdrop click closes; all motion is `motion-reduce:transition-none`;
- the shared `sameOriginPath` guard (now `apps/web/src/lib/image-url.ts`, reused
  by `GameCover`) rejects any non-`/` source, matching the CSP `img-src 'self'`.

# Out of scope

- No bulk backfill command: existing rows keep `t_thumb` covers and have no
  gallery until re-enriched.
- No UI/API editing or reordering of the gallery.
- No MobyGames gallery; no new BullMQ queue; no distinct gallery thumbnail width.

# Tests

- `igdb-image-url.spec.ts` (unit): protocol-relative, existing-size replacement,
  size insertion, null/blank, idempotency, non-IGDB URL passthrough.
- `igdb-game-catalog.resolver.spec.ts` (unit): `t_1080p` cover, artworks-first
  ordering, dedupe, the 8-image cap, malformed-entry handling.
- `igdb.client.spec.ts` (unit): the query requests `screenshots.url,artworks.url`
  in hydration but not in the phase-1 id search.
- `game-enrichment.service.spec.ts` (unit): gallery caching to local paths with
  `sourceUrl`, a dropped failed download.
- `reenrichment.spec.ts` (unit): gallery replacement, identical-order no-op,
  empty-candidate preservation.
- `games.service.spec.ts`, `import-jobs.service.spec.ts` (unit): nested create,
  gallery replacement cleanup, delete/duplicate cleanup.
- `cover-maintenance.service.spec.ts` (unit): a `GameImage` reference keeps the
  file.
- `game-detail.mapper.spec.ts` (unit): ordered `images` with derived `thumbUrl`,
  `sourceCoverUrl` stripped.
- `game-gallery.e2e-spec.ts` (e2e): `POST /games` with a candidate carrying an
  artwork + screenshot caches and persists the gallery, `GET /games/:id` returns
  same-origin `url`/`thumbUrl` with no external host, both routes serve the bytes,
  and `DELETE /games/:id` removes the files and rows.
- `game-reenrichment.e2e-spec.ts` (e2e): apply persists a gallery, re-apply
  replaces it and removes the dropped files, an empty candidate gallery keeps the
  stored one and writes nothing.
