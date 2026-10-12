---
type: Feature
title: Anti-hallucination Validation
description: No `Game` row is written without an external source confirming the recognized title — an ordered IGDB → MobyGames → unrecognized chain with a transient short-circuit and a MANUAL-only bypass.
tags: [import, validation, igdb, mobygames, catalog]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-06T16:35:37Z }
---

# Overview

The vision model can invent a plausible-sounding title that does not exist. The
anti-hallucination invariant is: **a recognized title is saved as a `Game` only
after an external game database confirms it.** A title no external source
confirms is traced as an `UnrecognizedItem` (with its raw string preserved) and
never enters the catalog.

This is the validation step of the [Photo Import Pipeline](/photo-import-pipeline.md)
(step 3 of its algorithm) and it composes the external clients described in
[IGDB Client & Rate Limiter](/igdb-client.md). The saved rows are read back
through the [Catalog API](/catalog-api.md).

# The ordered chain

`GameCatalogResolver` is a port (an abstract class used as the Nest DI token).
Its production binding is `ChainedGameCatalogResolver`, which iterates the
injected ordered source list (`GAME_CATALOG_SOURCES`, array order = validation
order) and stops at the first decisive outcome:

| Source outcome | Chain behavior                                                                 |
| -------------- | ------------------------------------------------------------------------------ |
| `matched`      | Return the candidate immediately; later sources are never called.              |
| `unrecognized` | This source has no candidate — **fall through** to the next source.            |
| `transient`    | Lookup failed and a retry may succeed — **stop** and return `transient` as-is. |

The sequence is therefore **IGDB → MobyGames → unrecognized**. Production
registers `IgdbGameCatalogResolver` (`label = 'IGDB'`) first and, when
`MOBYGAMES_API_KEY` is set, `MobygamesGameCatalogResolver`
(`label = 'MobyGames'`) second; with no key the fallback source is not registered
at all, so validation is IGDB-only. The chain and the pipeline are unchanged
either way; see [MobyGames Fallback](/mobygames-fallback.md).

## Why `transient` short-circuits

`transient` (rate limit, timeout, 5xx, network) means "unknown", not "not a
game". Treating it as a miss would permanently drop a real title while a source
is merely throttled or down. So the chain returns the first `transient` without
consulting later sources, and the pipeline leaves the item `pending` and throws
`RetryableImportError` so the worker retries it. Only an `unrecognized` outcome —
every configured source answered "no candidate" — marks the title permanently
unrecognized.

## The aggregated reason

When every source returns `unrecognized`, the chain emits one reason string that
preserves each source's label and reason for diagnostics, for example:

```
No game matched the title in any source — IGDB: No IGDB game matched the title; MobyGames: No MobyGames game matched the title
```

Each source's reason is preserved verbatim; IGDB distinguishes "no candidates
at all" (`No IGDB game matched the title`) from "candidates returned but none
cleared the confidence threshold" (`IGDB returned candidates but none matched
the title closely enough`), so a rejected-but-real candidate is never traced as
if the game were absent from the database. A tie between two or more candidates
at the same score (e.g. two franchise-prefix suffix matches at 0.95) is a
third case: `Multiple IGDB candidates matched equally well (A, B, C) — choose
one`, and the item's `candidates` array is populated so the user can pick one
(card 105). A 1.0 exact-name match still wins over a 0.95 prefixed one, so a
tie only occurs when no candidate is strictly better.

With no source configured the reason is `No game catalog source is configured`.

# Unrecognized trace

An unrecognized title is never silently dropped. The pipeline records it as an
`UnrecognizedItem` (`rawTitle`, optional `rawPlatform`, and the `reason` above)
and flips its `RecognizedItem.status` to `unrecognized`; the job ends
`needs_attention`. Re-processing an already-flagged item rolls back instead of
writing a second trace row, so the trailing records are idempotent under retry
(see [Photo Import Pipeline](/photo-import-pipeline.md)).

# Persisting a confirmed candidate

A `matched` candidate is mapped onto a `Game` by
[Game Metadata Enrichment](/game-metadata-enrichment.md): the confirmed source
supplies title/year/publisher/genre/playerCount and provenance
(`source`/`enrichedAt`), the raw payload is archived (never queried), and the
cover is cached locally so `coverUrl` is same-origin. A field the source does not
provide stays empty rather than being invented.

# The MANUAL-only bypass

External validation only applies to titles the vision model recognized. A user
who adds a game by hand through `POST /games` writes a `Game` directly, with the
`Game.source` enum defaulting to `MANUAL` (`GameSource = IGDB | MobyGames |
MANUAL`). Manual entry is the **only** path that bypasses the chain; an imported
row is tagged with the source that matched it — `IGDB` or `MobyGames`
([MobyGames Fallback](/mobygames-fallback.md)). See the
[Catalog API](/catalog-api.md).

# Tests

- `chained-game-catalog.resolver.spec.ts` (unit): first-match-wins, ordered
  fall-through, aggregate reason, `transient` short-circuit, later-`transient`
  preservation, and the empty-source case.
- `anti-hallucination.e2e-spec.ts` (e2e): an invented title
  (`Zorblax Chronicles 9000`) missing from both sources yields zero `Game` rows,
  one `UnrecognizedItem` with the raw title and the aggregated reason, and a
  `needs_attention` job; a transient IGDB leaves the item `pending`, writes no
  `Game`/`UnrecognizedItem`, and never calls the fallback; a title IGDB misses
  that MobyGames matches yields one `Game` with `source = MobyGames` and a
  `done` job.

# Out of scope

- Wiring the batched `resolveBatch()` into the pipeline (deferred; not 4.4).
