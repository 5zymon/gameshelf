---
type: Feature
title: Manual Add with DB Search and Copy Count
description: GET /games/search (debounce-protected external search) and POST /games with a picked candidate or typed-only data; one shared identity rule reused by the import commit; POST /games/:id/copies and a copyCount column.
tags: [api, catalog, game-database, deduplication, copies]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-07T15:30:00Z }
---

# Overview

Manual add is a first-class catalog entry mode. An authenticated user searches
the external game database, picks a result to prefill the form, and saves either
a **linked** row (`source` + `externalId`) or a **typed-only unlinked** row
(`source = MANUAL`, `externalId = null`). A game that already exists in the
catalog is never inserted a second time: `POST /games` returns `409` carrying the
existing game, and the deliberate "I own another copy" action is a separate
`POST /games/:id/copies` that increments a new `copyCount` column.

The duplicate rule is **one pure function** (`isSameGameIdentity`) reused by both
manual add and the photo-import commit, so a re-uploaded shelf or an overlapping
photo resolves to the existing row instead of forking a new one. Manual add is
LLM-free by construction; it goes straight to the same external catalog chain the
import pipeline uses ([Anti-hallucination Validation](/anti-hallucination-validation.md)).

# Search endpoint

`GET /games/search?q=<partial title>` — behind the global `SessionGuard` (no
`@Public()`). It is declared **before** `GET /games/:id` in the controller so
`search` is not captured as an `id`.

Response (`GameSearchResponseModel`): a ranked `candidates` array reusing the
re-enrichment `EnrichCandidateModel` shape (metadata, platforms, `source`, and a
same-origin signed preview `coverUrl` — the external host and the archival `raw`
payload are never exposed). See [Game Re-enrichment](/game-reenrichment.md) for
that candidate model.

Search is server-side debounce-protected; the query it forwards is trimmed and
must normalize to at least `CATALOG_SEARCH_MIN_QUERY_LENGTH = 2` characters,
otherwise the API returns `{ "candidates": [] }` **without any upstream call**.

| Protection                  | Behaviour                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minimum length              | `< 2` normalized characters → `[]`, the resolver is not called                                                                                                        |
| Short-TTL cache             | A successful result (including an empty list) is cached for `CATALOG_SEARCH_CACHE_TTL_MS` (60 s), bounded to `CATALOG_SEARCH_MAX_CACHE_ENTRIES` (100, oldest evicted) |
| In-flight coalescing        | Two identical concurrent queries share one upstream call                                                                                                              |
| Errors                      | `transient`/`config_error` results are never cached and are passed through                                                                                            |
| Bound + shared rate limiter | At most `CATALOG_SEARCH_MAX_RESULTS` (10) candidates; every source call runs through the existing per-provider limiters                                               |

The cache is per-process (lost on restart); the minimum length and coalescing are
the durable protections. Every source call already routes through the shared
IGDB / MobyGames rate limiters, so a burst of manual searches cannot exceed the
provider budget.

## Search port

`GameCatalogResolver` gains `search(query)` and `GameCatalogSource` gains the
same method; `CatalogSearchResult` is
`{ kind: 'matches'; candidates } | { kind: 'transient'; reason } | { kind: 'config_error'; source; reason }`.
Per-source `search` **never throws**: a config error maps to `config_error`, a
retryable error to `transient`, anything else to an empty `matches`. IGDB and
MobyGames re-rank the raw result with the shared `rankTitleMatches`, keep only
`score > 0` and cap at 10 — no `0.8` confidence gate, because a human picks from
the list. `ChainedGameCatalogResolver.search` is IGDB-first: the next source is
queried only when earlier sources returned no candidates (rate-limit friendly).

`CatalogSearchService` wraps the port with the cache/coalescing/min-length
logic and is registered in `GameCatalogModule`.

# Create (`POST /games`)

`POST /games` remains a pure create (`201`). `CreateGameDto` gains an optional
`candidate: { source, externalId }` (the same value object re-enrichment uses).

- **Unlinked / typed-only** (no `candidate`): the body is saved as today —
  `source = MANUAL`, `externalId = null`. This works with no game database
  configured and when the database reports `config_error`.
- **Linked / picked** (`candidate` present): the service re-runs the ranked
  search against `dto.title`, requires the pick to still appear, and then saves
  the row through the import mapping (`GameEnrichmentService.enrichCandidate`):
  the candidate is the source of truth for metadata and cover, while `platformId`
  and `edition` are the user's confirmed inputs. A pick that no longer appears is
  a `409` (`The selected candidate is no longer available; run the search
again`), mirroring re-enrichment's stale-pick rule. `dto.coverUrl` is ignored
  when a `candidate` is present (the catalog cover wins), so an ephemeral preview
  URL is never stored.

The identity check runs **before** any cover download, so a duplicate never
orphans a downloaded file.

# Identity rule (one function, two callers)

`apps/api/src/games/game-identity.ts` is a pure, Nest-free module:

- `isSameGameIdentity(a, b)` returns true when `platformId` matches, the
  normalized `edition` matches, and then one of:
  - both sides linked (`externalId !== null && source !== 'MANUAL'`) →
    `source` + `externalId` match; or
  - otherwise → `normalizeTitle(title)` matches.
- `normalizeEdition` folds blank/whitespace to `null`.
- `GAME_ALREADY_IN_CATALOG` is the machine-readable `409` code.

The rule is symmetric, so a linked import matches an existing unlinked manual row
and vice versa. `GameIdentityService.findExisting(input, client?)` is the lookup:
it narrows by `platformId` (indexed) then applies the pure rule in JS (title and
edition are normalized, so no exact SQL match exists). The import commit passes
its transaction (`tx`) as `client` so a row created earlier in the same batch is
seen.

**Deliberate trade-off:** the symmetric title fallback can merge two genuinely
different games that share a normalized title/platform/edition where one side is
unlinked. This is the intended dedup behavior; there is deliberately **no unique
DB constraint**, because owning several copies must remain legal and identity is
app-level.

# Duplicate 409 and copies

A duplicate create returns `409` with a structured body:

```jsonc
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "GAME_ALREADY_IN_CATALOG",
  "message": "This game is already in the catalog — add another copy?",
  "game": {/* full GameDetailModel of the existing row */},
}
```

`POST /games/:id/copies` (`@HttpCode(200)`) atomically increments `copyCount`
(`{ increment: 1 }`) and returns the updated `GameDetailModel`. It never creates a
row; unknown `id` → `404`. The frontend ticket calls this with `game.id` from the
`409` body.

# Import reuse (link, no increment)

`commitImportBatch` replaces its unconditional `tx.game.create` with the same
`GameIdentityService.findExisting(input, tx)` lookup:

- A match links the recognized item to the existing `gameId` and does **not**
  increment `copyCount`. The card's examples (overlapping shelf photos, re-upload,
  a retry with a better photo) are the _same physical copy seen twice_, so
  incrementing would falsely inflate the count. The deliberate-copy path is
  `POST /games/:id/copies`.
- No match inserts one row. The transaction makes the check authoritative, so two
  items in one batch that resolve to the same game create exactly one row.
- A freshly downloaded cover for a duplicate is not adopted; after the transaction
  commits, `CoverMaintenanceService.removeIfUnreferenced` (ref-counted) deletes it
  only when no other game references it ([Local Cover Cache](/local-cover-cache.md)).

Re-enrichment is unchanged: it still links a previously unlinked game in place
([Game Re-enrichment](/game-reenrichment.md)).

# Data model

Migration `20261007151848_add_game_copy_count` adds one column (default `1`, no
backfill):

```sql
ALTER TABLE `games` ADD COLUMN `copy_count` INTEGER NOT NULL DEFAULT 1;
```

`GameDetailModel.copyCount` is exposed on `GET /games/:id`, the create/update/copy
responses, and the `game` block of the enrich response (it is spread by
`toGameDetail`).

# Status / error matrix

| Situation                                            | HTTP | Body / behaviour                                                      |
| ---------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| search, matches                                      | 200  | `{ candidates: [...] }`, mutates nothing                              |
| search, query below minimum length                   | 200  | `{ candidates: [] }`, no upstream call                                |
| search, transient/config_error                       | 503  | `ServiceUnavailableException(reason)`                                 |
| create, typed-only                                   | 201  | `source:"MANUAL"`, `externalId:null`, `copyCount:1`                   |
| create with candidate, verified                      | 201  | linked row (`source`+`externalId`), catalog metadata/cover            |
| create with candidate, pick absent from fresh search | 409  | `The selected candidate is no longer available; run the search again` |
| create, identity already exists                      | 409  | `code:"GAME_ALREADY_IN_CATALOG"` + `game` (no write)                  |
| create, unknown `platformId`                         | 400  | `Platform with id <n> does not exist`                                 |
| add copy, known id                                   | 200  | `copyCount` incremented, same row                                     |
| add copy, unknown id                                 | 404  | `NotFoundException`                                                   |

# Tests

- `game-identity.spec.ts` (unit): linked matches on source+externalId; different
  externalId/source/platform/edition/title rejected; symmetric linked↔unlinked
  title fallback; normalized title (case/diacritics/punctuation); blank vs null
  edition; `normalizeEdition`; stable `GAME_ALREADY_IN_CATALOG`.
- `catalog-search.service.spec.ts` (unit): min-length short-circuit; TTL cache;
  TTL expiry re-call; concurrent coalescing; distinct queries; transient /
  config_error not cached.
- `games.service.spec.ts` (unit): `search` mapping + preview + raw stripping and
  `q` default; transient/config_error → 503; unlinked duplicate → 409 with
  `code`/`game` and no write; verified pick calls `enrichCandidate`; stale pick →
  409; linked duplicate → 409 without a cover download; `addCopy` increment and 404.
- `import-jobs.service.spec.ts` (unit): a matched identity links the item without
  `game.create`, `copyCount` untouched, and the duplicate cover is cleaned up.
- `chained-game-catalog.resolver.spec.ts`, `igdb-game-catalog.resolver.spec.ts`,
  `mobygames-game-catalog.resolver.spec.ts`, `game-catalog.module.spec.ts`
  (unit): ordered search, first-hit-wins, empty fall-through, transient/
  config_error short-circuit, ranked results, permanent-error → empty matches,
  malformed MobyGames row degraded to empty.
- `games-manual-add.e2e-spec.ts` (e2e): same-origin preview cover and no `raw`;
  min-length and cache/coalescing (one upstream call); config_error → 503 while
  typed `POST /games` still succeeds; linked create with cached cover; confirmed
  platform/edition; stale pick → 409; unlinked duplicate → 409 + copies → 200 with
  `copyCount:2` and still one row; two normalized-equivalent unlinked titles are
  one identity; `copyCount` on the detail.
- `games.e2e-spec.ts` (e2e): `copyCount:1` on detail/create.
- `photo-import-pipeline.e2e-spec.ts` (e2e): two recognized items resolving to the
  same external record yield one `Game` row (both items `imported`, same
  `gameId`) and `copyCount` stays 1.

# Out of scope

- Frontend form/UI (ticket 5.5) and list rendering of the copy count (ticket 5.4);
  any change under `apps/web`.
- A DB unique constraint (multiple copies must remain legal).
- Real-time search against the **local** catalog, and a by-external-id fetch
  endpoint (create re-verifies by re-running the ranked search, matching the
  re-enrichment precedent).
- Setting `platformUnverified`, provenance clearing, or multi-source merge beyond
  the existing chain.
