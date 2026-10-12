---
type: Feature
title: Local Cover Cache
description: Downloaded game covers stored in the backend, locally generated catalog thumbnails, same-origin serving, a signed preview passthrough for unsaved candidates, background retry, and a covers:redownload repair command.
tags: [covers, caching, thumbnails, images, cli]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-07T13:30:00Z }
---

# Overview

The [Game Metadata Enrichment](/game-metadata-enrichment.md) feature downloads a
candidate's external cover into a local cache and serves it same-origin. This
feature extends that cache into a complete local cover store:

- covers are **always** written to persistent storage (`COVERS_DIR`) and are
  never referenced by an external URL;
- a catalog **thumbnail** is generated locally with `sharp`, so grids never
  fetch a CDN thumbnail;
- unsaved candidates (re-enrichment search results) are proxied through a
  **signed same-origin preview** route, so the external host never reaches the
  browser;
- a failed download keeps the game saved with a `coverUrl: null` placeholder and
  its external link, and a **background sweep** retries it;
- replacing a cover removes the old file (ref-counted) and deleting a game
  removes its unreferenced cover;
- the documented `npm run covers:redownload` command repopulates every missing
  cover from the stored `source`/`externalId`-adjacent `sourceCoverUrl` link,
  for example after the cover directory is wiped.

It is the backend half of the catalog cover experience; the catalog grid UI
(ticket 5.2) is out of scope. The [Game Image Gallery](/game-image-gallery.md)
builds on the same cache for per-game IGDB screenshots/artworks and rewrites
IGDB covers to `t_1080p`.

# Storage & naming

```
candidate.coverUrl (external) ──download──▶ COVERS_DIR/<sha256(url)[:32]>.<ext>
                                                     │
saved Game.coverUrl = /api/covers/<file> ────────────┘
saved Game.sourceCoverUrl = <external url>  (internal, never serialized)
```

- **Deterministic name.** `CoverCacheService.cacheFromUrl` stores
  `<sha256(url)[:32]>` plus an extension derived from the response content type
  (`.jpg`/`.png`/`.webp`). The same URL always maps to the same file and is
  never re-downloaded.
- **`sourceCoverUrl`.** `Game.sourceCoverUrl` (migration
  `20261007114745_add_game_source_cover_url`) keeps the external URL that the
  local file was derived from. It drives the background retry and
  `covers:redownload`. It is **internal**: the response mapper strips it, so it
  is never serialized (ADR-001 — a normalized column, never derived from
  `rawMetadata`).

# Thumbnails

`makeThumbnail(buffer)` (`cover-thumbnail.ts`) uses `sharp` to render a WebP
bounded to `COVER_THUMBNAIL_WIDTH` (300 px), without enlargement, with EXIF
rotation applied. It is best-effort: undecodable bytes resolve to `null` and a
thumbnail is simply absent.

`CoverCacheService.ensureThumbnail(file)` writes `<hash>.thumb.webp` next to the
full cover; `readThumbnail(file)` reads it. Thumbnails are generated on download,
on a cache hit, and by the recovery paths.

# Same-origin serving

`CoversController` exposes three routes, all behind the global `SessionGuard` (no
`@Public()`), so a browser `<img>` sends the first-party cookie:

| Route                                               | Serves                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /covers/:file`                                 | the full stored cover (`/api/covers/<file>`)                                                                              |
| `GET /covers/thumbs/:file`                          | the generated WebP thumbnail, falling back to the full cover bytes when no thumbnail exists (`/api/covers/thumbs/<file>`) |
| `GET /covers/preview?u=<b64url>&s=<hmac>&e=<epoch>` | a server-side fetched, in-memory thumbnail of an **unsaved** candidate                                                    |

No route ever issues a redirect to an external host. The web app's `/api/:path*`
rewrite ([Single-Origin Frontend & API](/single-origin-frontend-api.md)) makes
these first-party `/api/covers/...` URLs to the browser.

## Preview passthrough

Re-enrichment search results have no stored file. `CoverPreviewService.previewUrl`
returns an opaque, signed same-origin URL; `resolve` verifies the HMAC
(`covers:preview:<url>:<expiry>`), rejects a missing/tampered/expired `e`
(epoch seconds, 24 h TTL), rejects non-HTTP(S) schemes, and enforces the shared
host allowlist (`isAllowedCoverHost`, `COVER_PREVIEW_HOSTS`, defaulting to the
IGDB and MobyGames image hosts). `fetch` downloads the image and renders an
in-memory thumbnail (falling back to the original bytes). This closes the SSRF
surface: the URL is signed **and** allowlisted. The external candidate URL is
dropped from the response; the existing `EnrichCandidateModel.coverUrl` field now
carries the preview URL.

The same `isAllowedCoverHost` guard is enforced at the download seams:
`CoverCacheService.cacheFromUrl` rejects a non-allowlisted host before any
request, and `FetchCoverHttpClient` follows redirects with a bounded manual loop
(max 5 hops), validating the host of every redirect target's `Location` **before**
connecting to it, so a redirect cannot escape the allowlist.

# Background retry

Per ADR-005 (one photo-import queue) there is **no** second queue. A
`CoverSweepService` runs on an `@Interval` (default 15 min, overridable with
`COVER_RETRY_SWEEP_INTERVAL_MS`, batch `COVER_RETRY_BATCH_SIZE` = 50) and calls
`CoverRecoveryService.retryMissing()`, which retries games left with
`coverUrl: null` and a `sourceCoverUrl`. The sweep is bounded
(`COVER_RETRY_SWEEP_MAX_PAGES` pages per run) and its cursor **rotates** across
runs, so a permanently-failing low-id row cannot starve later ones. This mirrors
the [Photo Lifecycle](/photo-lifecycle.md) sweep. A failed cover download
therefore never fails an import item: the game is saved with a placeholder and
healed later.

# Re-download command

```bash
npm run covers:redownload
```

`apps/api/src/cli/covers.ts` boots a Nest application context and runs
`CoverRecoveryService.redownloadMissing()`: it pages every game with a
`sourceCoverUrl`, keeps a file that is already present (ensuring its thumbnail),
and re-downloads any missing cover into the deterministic local name. Each game
is restored in isolation — one game's download **or row-update** error is logged,
counted as `failed`, and never aborts the run, so the command still repopulates
every recoverable cover. It prints
`total/downloaded/present/failed/noSource` and exits non-zero if any download
failed. This is the recovery path after the cover directory is wiped or restored
from a database dump without files.

# Deletion & replacement

`CoverMaintenanceService.removeIfUnreferenced(servedUrl: string | null, except?: { exceptCoverGameId?: number; exceptImageGameId?: number }): Promise<void>` deletes
a stored cover (and its thumbnail) only when neither a `Game.coverUrl` nor a
`GameImage.url` still references the same path — ref-counted, so a sibling
imported from the same candidate is never broken. It is invoked when a game's
cover changes on `PATCH`/re-enrichment and when a game is deleted; the
[Game Image Gallery](/game-image-gallery.md) additionally removes replaced
gallery files on re-enrichment and all gallery files on delete/duplicate import.
On `PATCH`, re-submitting the game's **current** local path preserves its stored
`sourceCoverUrl` (only an explicit `null` clears it), and re-enrichment removes a
downloaded candidate cover that provenance refused to adopt, so neither path
orphans a file.

# Configuration

| Variable                        | Default                                           | Purpose                                                               |
| ------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| `COVERS_DIR`                    | `~/.gameshelf/covers`                             | on-disk cover cache location                                          |
| `COVER_PREVIEW_HOSTS`           | `images.igdb.com,www.mobygames.com,mobygames.com` | host allowlist for every cover download (cache + preview passthrough) |
| `COVER_PREVIEW_SECRET`          | `SESSION_SECRET`                                  | HMAC key for preview URLs                                             |
| `COVER_RETRY_SWEEP_INTERVAL_MS` | `900000` (15 min)                                 | background retry interval                                             |

See the root `README.md` and `.env.example`.

# Tests

- `cover-thumbnail.spec.ts` (unit): a real image renders a width-bounded WebP; a
  small image is not enlarged; undecodable bytes resolve to `null`.
- `cover-preview.service.spec.ts` (unit): same-origin signed URLs, signature
  verification, signed expiry (expired/tampered/missing `e` rejected), host-allowlist
  and scheme rejection, fetch/thumbnail/fallback behavior.
- `cover-recovery.service.spec.ts` (unit): `redownloadMissing` counts (including a
  per-game update failure that is counted and does not abort the run),
  `refreshGame` failure-then-success, `retryMissing` paging/rotation.
- `cover-sweep.service.spec.ts` (unit): delegation and error swallowing.
- `cover-maintenance.service.spec.ts` (unit): ref-counted delete.
- `run-covers.spec.ts` (unit): CLI summary and exit codes.
- `cover-cache.service.spec.ts` (unit): allowlist rejection/override, thumbnail
  generation, `has`, `ensureThumbnail`, `readThumbnail`, `removeByServedUrl`,
  `fileFromServedUrl`.
- `cover-http.client.spec.ts` (unit): stream caps/timeout plus host-allowlist
  rejection (initial host and post-redirect final URL) and override.
- `covers.e2e-spec.ts` (e2e): a real pipeline run serves the full cover and a
  locally generated `image/webp` thumbnail; a failed download leaves the game
  saved with the external link and a later `refreshGame` restores cover +
  thumbnail; the signed preview serves and rejects tampering; deleting the game
  removes the file.
- `cover-recovery.e2e-spec.ts` (e2e): after the cover directory is wiped,
  `redownloadMissing` restores every linked cover and thumbnail.
- `games.e2e-spec.ts` (e2e): an external `coverUrl` on `POST`/`PATCH /games` is
  downloaded and returned as a same-origin path, a non-allowlisted host is
  rejected into a placeholder, re-submitting the current local path preserves the
  source link, `sourceCoverUrl` is never serialized, and a failed download yields
  a placeholder.
- `game-reenrichment.e2e-spec.ts` (e2e): the candidate cover is a same-origin
  preview with no external host; `sourceCoverUrl` is persisted; the replaced file
  is unlinked; a failed re-enrichment download does not clobber the existing
  cover.

# Out of scope

- The catalog grid UI and `<img>` wiring (ticket 5.2).
- Backfilling covers for rows created before this feature (only rows with a
  `sourceCoverUrl` can be repaired; older rows need re-enrichment).
- A second queue for retries (ADR-005).
