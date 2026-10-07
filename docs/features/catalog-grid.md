---
type: Feature
title: Catalog Grid
description: The server-paginated cover-art grid at `/` with title/platform tiles, a title-carrying placeholder for missing covers, same-origin thumbnails, lazy loading, a URL-synced filter/search bar (ticket 5.3), and an empty state pointing at manual add and photo import.
tags: [web, ui, catalog]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-07T18:58:07Z }
---

# Overview

The catalog is the authenticated landing page at `/` (the "Catalog" target in `main-nav.tsx`). It renders one tile per game — cover art, title, and platform — as a responsive grid backed by the paginated `GET /games` endpoint from the [Catalog API](/catalog-api.md) and the typed server client from [Web API Client](/web-api-client.md).

The page (a server component) reads `searchParams`, validates `page` to an integer ≥ 1, validates the filter params (see [Catalog Filters & Search](/catalog-filters.md)), and requests a fixed page of `PAGE_SIZE = 24` games. The DOM therefore never holds the whole catalog: at most 24 tiles are rendered per request, and navigation between pages is ordinary server-rendered `<Link>`s (`/?page=2`), with no client fetch and no `useSearchParams`.

# Behaviour

| Concern           | Behaviour                                                                                                                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grid              | `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`, mobile-first; each tile is an `<li>` for a semantic list.                                                                                                                                                                                                                |
| Tile              | Cover (or placeholder) plus the game title and `platform.name`. Titles are `truncate`d with a `title` attribute for the full value.                                                                                                                                                                                   |
| Missing cover     | `GameCover` renders a gradient `aspect-[3/4]` frame carrying the title, so a null cover is a designed state, not a broken-image glyph.                                                                                                                                                                                |
| Thumbnails        | Only `coverThumbUrl` is used (falling back to same-origin `coverUrl`); the API pre-generates a width-≤300 WebP thumbnail (see [Local Cover Cache](/local-cover-cache.md)).                                                                                                                                            |
| Same origin       | `sameOriginPath()` accepts only root-relative paths (`/…`, never `//…`), so an external URL can never reach the `<img>`. The API serves covers at `/api/covers/<file>` via the same-origin rewrite; the [CSP](/single-origin-frontend-api.md) `img-src 'self'` blocks anything external anyway.                       |
| Lazy loading      | The first 4 tiles are `loading="eager"` + `fetchPriority="high"`; every other image is `loading="lazy"`, all `decoding="async"`.                                                                                                                                                                                      |
| Pagination        | `CatalogPagination` shows Previous/Next `<Link>`s and "Page N of M"; disabled ends are non-interactive `<span>`s. `pageHref` preserves the parsed filters (so paging keeps the current filter combination) but drops `page` when returning to page 1.                                                                 |
| Empty catalog     | When `meta.total === 0` and no filter is active, `EmptyCatalog` presents "Nothing on the shelf yet" with **Add a game** → `/games/new` and **Import from photos** → `/import`; a filtered empty result instead shows the [Catalog Filters & Search](/catalog-filters.md) no-results state with the bar still visible. |
| Out-of-range page | When the catalog is non-empty but the requested page has no items, a distinct "That page has no games" message with a link back to the first page is shown (not the entry-path empty state).                                                                                                                          |
| Auth              | `getGames` returns `null` on `401`; the page then `redirect('/login')`, unchanged from before. Other API errors propagate to the Next error boundary (richer error UI is a later ticket).                                                                                                                             |

# Components

- `apps/web/src/app/(app)/page.tsx` — `CatalogPage` and the private `EmptyCatalog`/`NoResults`; `parsePage` and `pageHref` helpers.
- `apps/web/src/components/game-card.tsx` — `GameCard`, the `<li>` grid item.
- `apps/web/src/components/game-cover.tsx` — `GameCover` and the `sameOriginPath` guard.
- `apps/web/src/components/catalog-pagination.tsx` — `CatalogPagination` (server-rendered links).
- `apps/web/src/components/catalog-filter-bar.tsx` — `CatalogFilterBar`, the client filter/search bar (ticket 5.3).
- `apps/web/src/lib/catalog-filters.ts` — `parseCatalogFilters`/`catalogHref`/`hasActiveFilters` (ticket 5.3).
- `apps/web/src/app/(app)/games/new/page.tsx` — placeholder page so the empty-state "Add a game" link resolves.

# Notes

- `next/image` is deliberately **not** used. `coverThumbUrl` is already a locally thumbnailed, width-bounded WebP (ticket 4.10), and the covers route sits behind the global `SessionGuard`; a plain same-origin `<img>` sends the first-party session cookie directly, whereas the `/_next/image` optimiser hop is unnecessary and the cookie forwarding is less direct. No `images.remotePatterns` configuration is needed. The `@next/next/no-img-element` warning is suppressed inline with this reasoning.
- Tiles are `next/link` `Link`s to `/games/[id]` (ticket 5.4); the cover frame gains a restrained `group-hover:border-accent/70` affordance (`motion-reduce:transition-none`).
- `alt=""` on the cover is intentional — the title is always visible adjacent text in the tile, avoiding a duplicate announcement.

# Out of scope

- Filters / search / URL-synced filter bar — delivered in ticket 5.3; see [Catalog Filters & Search](/catalog-filters.md).
- Game detail, edit, and delete (ticket 5.4); see [Game Detail View with Edit, Delete & Re-enrich](/game-detail.md).
- The real manual-add form; only the `/games/new` placeholder exists here (ticket 5.5).
- Loading skeletons, error boundaries/retry, focus management, and further responsive polish (ticket 5.6).
- i18n (ticket 7.2) and platform management (ticket 7.1).

# Manual acceptance

1. With >24 games, open `/`: the grid shows cover tiles with title and platform; `document.querySelectorAll('main ul > li').length === 24`.
2. The range line reads "Showing 1–24 of N games"; **Next** points at `/?page=2`; the last page hides **Next**.
3. A game with no cover shows the gradient placeholder with its title and no broken-image glyph or 404.
4. At 375 / 768 / 1280 px the grid is 2 / 3 / 5 columns with no horizontal overflow.
5. With an empty catalog, **Add a game** opens the `/games/new` placeholder and **Import from photos** opens `/import`.
6. Below-the-fold images are `loading="lazy"`; the first four are `loading="eager"`.
7. Every image request on `/` is same-origin (`localhost:3000`); no external host appears and the Console shows no CSP `img-src` violation.
8. With a filter active, the range line reads "Showing X–Y of N matching games" and the URL carries only the whitelisted filter params.
9. Typing in **Search titles** navigates once per 300 ms pause and the chip row shows the active filter; **Clear all** returns to a filterless grid.
10. Filtering to no matches shows "No games match these filters" with the bar still visible; Browser **Back** restores the previous filtered grid.
