---
type: Feature
title: Game Metadata Enrichment
description: One reusable candidate→Game mapping plus a minimal local cover cache, so a saved game carries title/platform/year/publisher/genre/playerCount, a same-origin cover, and honest source/enrichedAt/raw archival.
tags: [import, enrichment, covers, catalog, caching]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-07T12:00:00Z }
---

# Overview

The [Photo Import Pipeline](/photo-import-pipeline.md) resolves a recognized
title to an external `CatalogCandidate` and then persists it as a `Game`. This
feature introduces the single, reusable **candidate→`Game` mapping** used by that
commit path, and the minimum **local cover cache** that makes a saved game's
`coverUrl` a same-origin path instead of an external URL.

It exists so that:

- the mapping lives in one place
  (`GameEnrichmentService.enrichCandidate` over the pure
  `mapCandidateToGameData`) and is reused by re-enrichment
  ([Game Re-enrichment](/game-reenrichment.md)) without re-implementing field
  rules;
- a saved `Game` is describable from the confirmed source candidate — title,
  canonical platform, release year, publisher, genre, player count — with
  missing source fields left **empty**, never invented;
- the browser never loads a cover from an external host: the cover is downloaded
  once into the local cache and served from the application's own origin
  (`/api/covers/<file>`), which the `img-src 'self'`
  [CSP](/single-origin-frontend-api.md) permits.

No schema migration is involved: `Game.playerCount`, `Game.coverUrl`,
`Game.rawMetadata`, `Game.enrichedAt`, and `Game.source` already exist.

# Candidate mapping

`mapCandidateToGameData` is pure — no IO, no defaults, no invented values:

| `Game` column | Source                                                               |
| ------------- | -------------------------------------------------------------------- |
| `title`       | `candidate.title`                                                    |
| `platformId`  | the locally resolved canonical `Platform.id` (unchanged)             |
| `edition`     | the **vision-read** edition only; never derived from the API payload |
| `releaseYear` | `candidate.releaseYear`                                              |
| `publisher`   | `candidate.publisher`                                                |
| `genre`       | `candidate.genre`                                                    |
| `playerCount` | `candidate.playerCount` (see below)                                  |
| `coverUrl`    | the locally cached, same-origin served path, or `null`               |
| `rawMetadata` | `JSON.stringify(candidate.raw)` — the archival column                |
| `enrichedAt`  | the enrichment timestamp                                             |
| `source`      | `candidate.source` (`IGDB` / `MobyGames`)                            |
| `externalId`  | `candidate.externalId` (the upstream row id, paired with `source`)   |

A source that does not expose a field leaves the column `null`; the mapper never
substitutes a default. In particular `edition` comes only from the vision item,
so IGDB's `version_parent` (an edition/version link) can never become an edition
value.

## Player count

- **IGDB.** `IGDB_GAME_FIELDS` now also requests
  `multiplayer_modes.offlinemax`, `.onlinemax`, `.offlinecoopmax`, and
  `.onlinecoopmax`. `IgdbGameCatalogResolver` takes the **maximum** of the four
  values across every `multiplayer_modes` entry, counting only positive
  integers, and yields `null` when none is present. See
  [IGDB Client & Rate Limiter](/igdb-client.md).
- **MobyGames.** The v2 search `include` exposes no player-count field, so a
  MobyGames candidate always has `playerCount: null`. Inventing one is
  forbidden. See [MobyGames Fallback](/mobygames-fallback.md).

# Raw archival (never used in queries)

The raw upstream payload is written verbatim to `Game.rawMetadata`
(`JSON.stringify(candidate.raw)`). The column is **archival**: it is never used
in a query predicate — no `filter`, `sort`, `where`, `orderBy`, or any derived
value is computed from it. It exists so re-enrichment
([Game Re-enrichment](/game-reenrichment.md)) can re-read the exact upstream
row, and it is surfaced read-only as part of the game-detail payload (`GameDetailModel.rawMetadata` on `GET /games/:id`, from
`GamesService.findOne`); that serialization is not a query use.

# Minimal local cover cache

```
candidate.coverUrl (external) ──download once──▶ COVERS_DIR/<sha256(url)[:32]>.<ext>
                                                        │
saved Game.coverUrl = /api/covers/<file> ──────────────┘
browser <img src="/api/covers/<file>"> ──rewrite /api──▶ API GET /covers/:file
```

- **Download.** `CoverCacheService.cacheFromUrl(url)` accepts only `http:` /
  `https:` URLs (SSRF guard), fetches with a hard `COVER_REQUEST_TIMEOUT_MS`
  (10 s) timeout, and accepts only `image/jpeg`, `image/png`, or `image/webp`
  bodies of at most `MAX_COVER_BYTES` (5 MB). It never throws to its caller: any
  failure (bad URL, non-image, oversize/empty, network/fs error) degrades to
  `null`, so a broken cover can never fail an import item.
- **Naming.** The stored name is a deterministic `sha256(url)` prefix (32 hex)
  plus an extension derived from the response content type. The lookup probes the
  deterministic `<hash>.jpg|.png|.webp` names, so an extensionless URL (or one
  whose extension disagrees with the response) still finds the file that was
  written. A URL already cached is not re-downloaded (idempotent), and the same
  cover URL always maps to the same file.
- **Serving.** `CoversController` (`GET /covers/:file`) serves the bytes with the
  extension-derived content type and an immutable `Cache-Control`. `read` accepts
  only a `^[a-f0-9]{32}\.(jpg|png|webp)$` filename, so path traversal is
  impossible; a missing/invalid file is a `404`. The route is behind the global
  `SessionGuard` (no `@Public()`), so a browser `<img>` on an authenticated page
  sends the first-party `gameshelf_session` cookie automatically.
- **Same-origin.** The web app's `/api/:path*` rewrite
  ([Single-Origin Frontend & API](/single-origin-frontend-api.md)) turns the
  API's `/covers/<file>` into the browser's same-origin `/api/covers/<file>`, so
  the cover never touches an external host and satisfies `img-src 'self'`.
- **Configuration.** `COVERS_DIR` overrides the cache directory; blank/absent
  falls back to `~/.gameshelf/covers`. See the root `README.md` and
  `.env.example`.

Locally generated thumbnails, the signed same-origin preview for unsaved
candidates, background retry, ref-counted deletion/replacement, and the
`covers:redownload` command are specified in
[Local Cover Cache](/local-cover-cache.md).

# Where it runs

`ImportJobsService.commitImportBatch` resolves every cover **outside** the DB
transaction (a slow download must not hold a MySQL transaction open) and maps
each resolved item through `GameEnrichmentService.enrichCandidate`, then writes
the returned data. It re-checks the terminal-status guard both before the
downloads and again inside the transaction.

# Residual risk

Rows created before this feature landed may still hold an **external**
`coverUrl` — there is no backfill. The browser's `img-src 'self'`
[CSP](/single-origin-frontend-api.md) blocks those external images, so once the
UI renders covers an old game shows no cover until it is re-enriched (ticket 4.7)
or repaired from a stored link by [Local Cover Cache](/local-cover-cache.md)
(ticket 4.10). New and re-enriched games store the same-origin
`/api/covers/<file>` path.

# Out of scope

The catalog grid UI that renders covers (ticket 5.2) and backfilling covers for
rows created before the cache existed. The cache's thumbnail generation,
same-origin preview passthrough, background retry, deletion/replacement, and
re-download command are specified in [Local Cover Cache](/local-cover-cache.md).

# Tests

- `game-enrichment.service.spec.ts` (unit): a real (sanitised) IGDB fixture maps
  to the full `Game` data with a `/api/covers/<hash>.jpg` cover, `source: IGDB`,
  and a `Date` `enrichedAt`; `JSON.parse(rawMetadata)` deep-equals the fixture
  raw; missing source fields stay `null`; a failed cover download yields
  `coverUrl: null` without dropping the rest; a present `version_parent` does not
  affect `edition`.
- `cover-cache.service.spec.ts` (unit): download + deterministic same-origin
  path, second-call reuse (no re-download), reuse for an extensionless URL and
  when the URL extension disagrees with the content type, `null`/blank/non-HTTP
  URLs, a non-allowlisted host (`COVER_PREVIEW_HOSTS` rejection/override),
  non-image content type, empty/oversize body, client failure → `null`,
  `read` round-trip, traversal rejection / missing file, default directory.
- `cover-http.client.spec.ts` (unit): the real `FetchCoverHttpClient` against a
  stubbed `fetch` — streamed body buffered, declared-oversize `Content-Length`
  short-circuited without reading, a chunked body cancelled once it crosses
  `MAX_COVER_BYTES`, the 10 s abort signal propagated and its abort rejected,
  a mid-stream error rejected, and host-allowlist enforcement (non-allowlisted
  host rejected before fetching, post-redirect final URL re-checked).
- `igdb-game-catalog.resolver.spec.ts` / `mobygames-game-catalog.resolver.spec.ts`
  (unit): `playerCount` derived from `multiplayer_modes` for the IGDB fixture
  (16) and always `null` for the MobyGames fixture.
- `covers.e2e-spec.ts` (e2e): a real pipeline run saves a game whose `coverUrl`
  matches `^/api/covers/[a-f0-9]{32}\.jpg$` with the full accepted field set
  (`title`/`platformId`/`releaseYear`/`publisher`/`genre`/`playerCount`/`source`/
  `enrichedAt`/`externalId`/`rawMetadata`) set; an unauthenticated `GET /covers/<file>` is
  `401` and an authenticated one returns `200` `image/jpeg` with the exact
  cached bytes; a failed download still saves the game with `coverUrl: null` and
  a `done` job.
