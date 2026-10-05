---
type: Feature
title: Catalog API
description: GET /games — paginated, filterable, searchable, sortable game listing with available filter values.
tags: [api, catalog]
status: stable
generated: { by: opencode/home-model, at: 2026-10-05T13:02:05Z }
---

# Overview

`GET /games` lists the game library with pagination, AND-combined filters,
case-insensitive partial title search, deterministic sorting, and a `filters`
block of available filter values for the filter bar.

# List endpoint contract

`GET /games` — query parameters:

| Name          | Type   | Bounds                                   | Semantics                                                            |
| ------------- | ------ | ---------------------------------------- | -------------------------------------------------------------------- |
| `page`        | int    | ≥ 1                                      | 1-based page number (default 1)                                      |
| `limit`       | int    | 1–100                                    | Page size (default 20)                                               |
| `platformId`  | int    | ≥ 1                                      | Exact platform FK match; unknown id returns an empty result, not 400 |
| `edition`     | string | ≤ 255 ch                                 | Exact match, whitespace-trimmed (empty/blank → ignored)              |
| `year`        | int    | 1000–2100                                | Exact `releaseYear` match                                            |
| `publisher`   | string | ≤ 255 ch                                 | Exact match, whitespace-trimmed (empty/blank → ignored)              |
| `genre`       | string | ≤ 255 ch                                 | Exact match, whitespace-trimmed (empty/blank → ignored)              |
| `playerCount` | int    | 1–100                                    | Exact match                                                          |
| `q`           | string | ≤ 255 ch                                 | Case-insensitive partial title search (see below)                    |
| `sort`        | enum   | `title`, `year`, `platform`, `createdAt` | Sort field; omitted → `id` ascending                                 |
| `order`       | enum   | `asc`, `desc`                            | Sort direction; only applies when `sort` is set (default `asc`)      |

Response shape (additive — `items`/`meta` unchanged from the base listing):

```json
{
  "items": [
    {
      "id": 1,
      "title": "Hollow Knight",
      "edition": null,
      "coverUrl": null,
      "platform": { "id": 1, "name": "PC", "slug": "pc" }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 },
  "filters": {
    "platforms": [{ "id": 1, "name": "PC", "slug": "pc" }],
    "editions": ["GOTY Edition"]
  }
}
```

# AND semantics

Every provided filter is combined with AND in a single Prisma `where` clause;
the same clause drives both the page query and the `meta.total` count, so the
two can never disagree. String filters (`edition`, `publisher`, `genre`, `q`)
are trimmed first; a value that is empty after trimming is ignored, so
`?genre=` behaves the same as omitting the parameter.

# Search (`q`)

- Implemented as Prisma `contains` → SQL `LIKE '%…%'` (ADR-001: no full-text
  search).
- Case-insensitivity comes from the table collation
  (`utf8mb4_unicode_ci`), not from a Prisma `mode` flag.
- `%`, `_`, and `\` in the input are backslash-escaped before embedding, so
  they match literally instead of acting as wildcards.

# Sorting

`sort` selects the primary key; `order` selects the direction (default
`asc`). `id ASC` is always appended as a tiebreaker, which makes the total
order deterministic — no duplicate or missing rows across pages:

| `sort`      | Effective `ORDER BY`                     |
| ----------- | ---------------------------------------- |
| `title`     | `title <order>, id ASC`                  |
| `year`      | `releaseYear <order> NULLS LAST, id ASC` |
| `platform`  | `platform.name <order>, id ASC`          |
| `createdAt` | `createdAt <order>, id ASC`              |
| _(omitted)_ | `id ASC`                                 |

`sort=year` puts games with unknown (`NULL`) year last regardless of
direction.

# Pagination

`meta.total` is the count of the **filtered** set (same `where` as the page
query); `meta.totalPages = ceil(total / limit)`. `skip = (page − 1) × limit`.

# `filters` block

Available values for the filter bar, computed **globally** — not scoped to
the current filter combination (no faceting):

- `platforms` — platforms that have at least one game, sorted by name.
- `editions` — distinct non-null edition values, sorted.

# Indexes

Filter columns on `games`. Five indexes were added in migration
`20261005130038_add_games_filter_indexes`; the `platform_id` index pre-exists
from `20261005111705_add_core_models`:

| Index                    | Column         |
| ------------------------ | -------------- |
| `games_platform_id_idx`  | `platform_id`  |
| `games_edition_idx`      | `edition`      |
| `games_release_year_idx` | `release_year` |
| `games_publisher_idx`    | `publisher`    |
| `games_genre_idx`        | `genre`        |
| `games_player_count_idx` | `player_count` |

Deliberately **no index on `title`**: a B-tree index cannot serve
`LIKE '%…%'` (leading wildcard), and full-text search is rejected by ADR-001.

# 400 semantics

The global `ValidationPipe` runs with `whitelist` + `forbidNonWhitelisted` +
`transform`:

- Unknown query parameter → 400 (every accepted parameter is declared in
  `ListGamesQueryDto`).
- Wrong type or out-of-bounds value (e.g. `limit=0`, `year=999`,
  `sort=bogus`, `order=up`) → 400.
- Unknown `platformId` is **not** a 400 — it is an FK reference, and an
  unknown id simply yields an empty result.
