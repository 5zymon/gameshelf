---
type: Feature
title: Catalog Filters & Search
description: The URL-synced filter bar on `/` — platform, edition, year, publisher, genre, player count, and a debounced title search — with API-sourced options, active-filter chips, clear-all, and a no-results state.
tags: [web, ui, catalog]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-07T19:38:28Z }
---

# Overview

The [Catalog Grid](/catalog-grid.md) at `/` is server-rendered and `force-dynamic`. Ticket 5.3 adds a filter/search bar above the grid that narrows the catalog through the existing [`GET /games` contract](/catalog-api.md) — no backend or contract change.

The URL is the single source of truth: the server component awaits `searchParams`, `parseCatalogFilters` validates them into a typed filter object, and that object is both sent to `getGames` and passed as the committed values to the client bar. The bar is a `'use client'` component receiving those committed values plus the `games.filters` options as props; every change calls `router.push('/?…')`, which triggers an RSC re-render and a fresh server fetch. There is no `useSearchParams`, no client-side data-fetching library, and no new dependency. Pagination stays server-rendered `<Link>`s and preserves the filters automatically.

# Parameters

Every filter is AND-combined server-side. Both the server parser and the client builder only ever emit the keys below, so an unknown or invalid param is dropped (`''`, non-numeric, out-of-range, or >255 characters) rather than sent — this is what keeps the endpoint from answering `400`.

| Param         | Control                                | Bounds / semantics                                 |
| ------------- | -------------------------------------- | -------------------------------------------------- |
| `q`           | Search titles (debounced)              | Case-insensitive partial title match, ≤255 ch      |
| `platformId`  | Platform select (options from the API) | Integer ≥1; unknown id → empty result, never `400` |
| `edition`     | Edition select (options from the API)  | Exact match, ≤255 ch                               |
| `year`        | Year text field                        | Integer 1000–2100                                  |
| `publisher`   | Publisher text field                   | Exact match, ≤255 ch                               |
| `genre`       | Genre text field                       | Exact match, ≤255 ch                               |
| `playerCount` | Players text field                     | Integer 1–100                                      |

`platformId`, `edition`, `year`, `publisher`, `genre`, `playerCount` and `q` are exactly the query layer's filter keys; `sort`/`order` exist in the client/contract but are not surfaced by this ticket.

# Behaviour

| Concern           | Behaviour                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| URL is state      | Committed values come from `searchParams`; the bar pushes a new `/?…` URL. Reload, share, and browser back all reproduce the same filtered grid.                                                                                           |
| Debounce          | All five text fields (`q`, `year`, `publisher`, `genre`, `playerCount`) share one 300 ms debounce, so a query is sent at most once per typing pause (not per keystroke). Enter flushes immediately.                                        |
| Selects           | Platform and edition are native `<select>`s; options come from `games.filters.platforms` / `games.filters.editions` (global facets), so they stay populated even when the current result set is empty. Options are never hardcoded.        |
| Active filters    | A chip row derived from the committed values shows every active filter; each chip's `×` removes that one filter and has a 24 px hit area with a visible focus ring (see [Catalog Loading, Error & Responsive States](/catalog-states.md)). |
| Clear all         | A **Clear all** button resets to `/` (all filters removed, `page` dropped).                                                                                                                                                                |
| Page reset        | Every filter/search change drops `page`, so a filter starts a fresh result set; pagination then restores `page` while preserving the filters.                                                                                              |
| Filtered count    | The range line reads `Showing X–Y of N matching games` when any filter is active (N is `meta.total` of the filtered set).                                                                                                                  |
| No results        | `meta.total === 0` with an active filter renders the `NoResults` state (message plus a **Clear all filters** link) **with the bar still visible**.                                                                                         |
| Empty library     | `meta.total === 0` with no active filter keeps the existing `EmptyCatalog` entry state (add a game / import photos) and renders no bar.                                                                                                    |
| Out-of-range page | A non-empty filtered set whose requested `page` has no items keeps the existing "That page has no games" message.                                                                                                                          |
| Pending           | `useTransition` dims the bar (`aria-busy`, `opacity-60`) while the RSC payload is in flight; text inputs are not disabled.                                                                                                                 |
| Back/forward      | Incoming URL values are reconciled per field so a back/forward navigation updates only the changed fields and never clobbers in-flight typing.                                                                                             |

# Components

- `apps/web/src/lib/catalog-filters.ts` — server/client-shared pure helpers: `CatalogFilterValues`, `CatalogSearchParams`, `FILTER_KEYS`, `parseCatalogFilters` (whitelist + bounds), `hasActiveFilters`, `catalogHref` (builds `/?…` from valid values, always dropping `page`).
- `apps/web/src/components/catalog-filter-bar.tsx` — the `'use client'` `CatalogFilterBar`: controls, 300 ms debounce, active-filter chips, and clear-all. Receives committed values and API options as props.
- `apps/web/src/app/(app)/(catalog)/page.tsx` — parses filters, sends them to `getGames`, renders the bar between the header and the grid, chooses `EmptyCatalog` vs `NoResults`, and renders the filtered range line.

# Out of scope

- Sort UI (`sort`/`order` exist in the query layer but are not requested by this ticket).
- Facet lists for the extended fields (year/publisher/genre/playerCount) — the contract exposes `platforms`/`editions` only, so those fields are free-text exact-match inputs.
- Backend or contract changes (none needed) and any new facet endpoint.
- Game detail links (ticket 5.4) and i18n (7.2).

# Manual acceptance

1. Open `/?q=hollow`: the grid narrows to titles containing "hollow"; the header reads "Showing 1–N of M matching games"; the URL is shareable and a reload reproduces the result.
2. Type in **Search titles** and pause: exactly one navigation happens per pause (≤1 push per 300 ms quiet period), and no request is fired per keystroke.
3. Select a **Platform**: the grid narrows; the URL gains `platformId=<id>`; the platform options come from the API (spot-check against `GET /games` `filters.platforms`).
4. Combine a search with a platform, year, publisher, genre, and player count: the result is the AND of all of them.
5. Chip row: every active filter has a chip; clicking a chip's `×` removes just that filter; **Clear all** returns to `/` with an empty bar.
6. Browser **Back** after a filter change restores the previous filtered grid; **Forward** re-applies it.
7. Filter to a term with no matches: **No games match these filters** appears with the bar still visible; **Clear all filters** resets the grid.
8. With >24 matching games, **Next** preserves the filters and adds `page=2`; changing a filter resets to page 1.
9. With an empty library (no filters), the existing "Nothing on the shelf yet" entry state shows and no filter bar is rendered.
10. The URL never contains an invalid/out-of-range value after using the controls (e.g. year `99999` or a blank text field), and the API never returns `400` from the bar.
