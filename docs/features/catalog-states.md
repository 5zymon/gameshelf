---
type: Feature
title: Catalog Loading, Error & Responsive States
description: Route-level loading skeletons for the catalog and game detail views, error boundaries with a working retry for failed fetches, focus management for the edit/delete controls, descriptive cover alt text, and mobile polish for the grid, filter bar and detail view.
tags: [web, ui, catalog, accessibility]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-08T21:54:58Z }
---

# Overview

Ticket 5.6 hardens the catalog surfaces delivered by [Catalog Grid](/catalog-grid.md),
[Catalog Filters & Search](/catalog-filters.md) and
[Game Detail View with Edit, Delete & Re-enrich](/game-detail.md): the pages
stream a route-level skeleton instead of blocking on an empty frame, a failed
fetch offers a real retry, slow covers no longer resize their grid slot, the
edit/delete controls manage focus, and every cover carries alt text. It also
removes the remaining templated-looking styling from the catalog screens
(ALL-CAPS accented eyebrows, middle-dot metadata joins and dashed "empty"
cards), while a game without cover art shows the designed gradient-initial
placeholder described in [Catalog Grid](/catalog-grid.md).

# Loading skeletons (no layout shift)

`apps/web/src/components/skeletons.tsx` holds the server-rendered skeletons.

| Route         | Fallback                                                               | Notes                                                                                                                          |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/`           | `apps/web/src/app/(app)/(catalog)/loading.tsx` → `CatalogSkeleton`     | Mirrors the header, filter form, 24-tile grid (`grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`) and pagination row. |
| `/games/[id]` | `apps/web/src/app/(app)/games/[id]/loading.tsx` → `GameDetailSkeleton` | Mirrors the back bar, header, cover column and the record grid.                                                                |

The catalog page was moved into an `(app)/(catalog)` **route group** so its
`loading.tsx` scopes to `/` only. A group-level `(app)/loading.tsx` would have
wrapped every `(app)` route (`/platforms`, `/settings`, `/import`,
`/games/new`); the route group keeps the same URL and the same `(app)/layout.tsx`
shell. Cover boxes reuse the real `aspect-[3/4]` frame and text rows use the same
line-box heights, so the fallback→content swap does not reflow the grid. The
catalog skeleton's filter area also mirrors the real `CatalogFilterBar` box model
(same `space-y-3 sm:space-y-4` wrapper, a `flex flex-col gap-3 lg:flex-row`
row — search block, chip group, sort block — the chip placeholders on one
clipped line (`overflow-hidden`), like the real scroller — and the toggle-line
placeholder, no extra border/padding box) so the panel chrome does not disappear
on swap.

**Known limitation:** for an empty library the skeleton (filter panel + 24 tiles)
does not know the catalog is empty, so the swap to `EmptyCatalog` is a large
vertical shift. The same applies to a filtered search that matches nothing (swap
to the no-results state) and to an out-of-range page (swap to the "That page has
no games" message): the skeleton cannot know the result count or the filter
outcome before the fetch completes. It only affects the first paint of a
genuinely empty or empty-after-filtering result, and is unavoidable without the
count up front. The filter skeleton also cannot know the platform-chip count (it
draws four) or whether the advanced panel starts open, so those swaps shift the
bar slightly.

# Error boundaries and retry

| Boundary  | File                                            | Catches                                                                                                                                                                                                               |
| --------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell | `apps/web/src/app/error.tsx` (`RootError`)      | A failure inside `(app)/layout.tsx` — e.g. `requireUser()` → `api.auth.me()` when the API is down. A same-segment layout error cannot be caught by `(app)/error.tsx`, so the root boundary is required for this case. |
| App pages | `apps/web/src/app/(app)/error.tsx` (`AppError`) | A page fetch failure (`getGames`/`getGame` 5xx or network) while keeping the navigation shell.                                                                                                                        |

Both render the shared `ErrorState`
(`apps/web/src/components/error-state.tsx`), whose **Try again** button calls
`router.refresh()` from `next/navigation` together with Next's `reset()`, both
wrapped in `startTransition`. Calling `reset()` alone only re-renders the client
tree: for a `force-dynamic`, `cache: 'no-store'` server fetch that threw, it does
not re-request the RSC payload, so no network request happens and the error
persists until a full reload. `router.refresh()` refetches the current route's
server render; `reset()` then clears the boundary so the fresh payload can
render in its place. Passing an optional `onReload` action threads a full-page
reload fallback: the root boundary uses it (
`window.location.reload()`) because its failed fetch may live in a parent/app
layout (`(app)/layout.tsx` → `requireUser()` → `api.auth.me()`); while
**Try again** re-runs the server render (`router.refresh()` + `reset()`), the
full document **Reload page** is the guaranteed fallback. The app-page boundary also offers a **Back to catalog** link as a
secondary action; the root boundary omits it (`showCatalogLink={false}`) because
that link would re-enter the failing `(app)/layout.tsx` and loop straight back
to the error while the API is down. `notFound()` and `redirect('/login')` are
unchanged and are not handled by user boundaries.

# Covers: slow loads and alt text

`GameCover` is now a `'use client'` component. It reserves a fixed
`aspect-[3/4]` frame and renders the `<img>` visible from first paint — a
contrasting pulse (edge tone on the shelf frame, not a same-colour toggle) is an
underlay behind the still-transparent image rather than a cover over it — so
priority covers can paint before hydration and with JavaScript disabled. A 500ms
fade is applied only to an image that finishes loading _after_ mount; an image
already complete at hydration snaps straight to full opacity (an `img.complete`
check covers React attaching handlers after the bytes arrived). A failed load
swaps to the gradient-initial placeholder, so a slow or failed image never
changes the grid geometry. When `thumbUrl` changes on a mounted instance (the detail
cover after a successful re-enrich + `router.refresh()`), the load state resets
for the new source so a previously errored cover can recover.

Alt text is contextual: covers used outside a labelled context keep the
descriptive `"<title> cover art"` (`game-detail-view.tsx` hero, `re-enrich-control.tsx`
candidate preview), while grid tiles pass `alt=""` because the tile `Link` already
names the game and platform via `aria-label` — so each grid item is announced
once.

# Focus management

- **Delete dialog** (`delete-game-button.tsx`, `role="alertdialog"`): focus moves
  to **Cancel** on open; `Tab`/`Shift+Tab` cycle between **Cancel** and
  **Delete**; cancel/Escape restores focus to the trigger.
- **Edit disclosure** (`game-edit-form.tsx`): opening the form focuses the
  **Title** field; Escape or a successful save closes it and returns focus to
  the **Edit record** toggle. The toggle carries `aria-expanded` and
  `aria-controls="game-edit-form"`.

# Responsive polish

- `(app)/layout.tsx` uses `px-4 sm:px-6` gutters and `py-8 sm:py-10`; the user
  email truncates on small screens.
- The detail cover is capped at `max-w-[10rem] sm:max-w-[12rem]` and only goes
  full-column at `md`, so the mobile detail page does not spend the first
  viewport on the cover.
- Filter chips have a 24 px remove hit area with a visible focus outline (the
  shared `:focus-visible` outline).
- The grid stays `grid-cols-2` at 375 px with no horizontal scroll.
- The platform chip strip scrolls horizontally inside itself (mouse drag anywhere with momentum, vertical wheel, native touch — see [Catalog Filters & Search](/catalog-filters.md)); the page never scrolls horizontally.

# De-templating

The catalog screens carry no template chrome: the header has no tracked ALL-CAPS
accent eyebrow; `EmptyCatalog`, `NoResults` and the out-of-range message are
`rounded-card` surface panels (`border-edge bg-surface`) instead of dashed
`rounded-2xl` cards; the detail provenance chips are status-dot tags
(`rounded-full` with an `h-1.5 w-1.5` tone dot); the detail metadata line uses
hairline structural separators (`h-3 w-px bg-edge`) instead of a `·` join; and
the recordset is an open, unboxed two-column `<dl>` with hairline `edge-soft`
rows. The gradient-initial `.cover-placeholder` (deterministic per-title tone,
huge first-letter initial) is the **designed** no-cover state, not a defect.

# Components

- `apps/web/src/components/skeletons.tsx` — `CatalogSkeleton`, `GameDetailSkeleton`, `GameCardSkeleton`, `SkeletonBlock`.
- `apps/web/src/app/(app)/(catalog)/loading.tsx`, `apps/web/src/app/(app)/games/[id]/loading.tsx` — route fallbacks.
- `apps/web/src/components/error-state.tsx`, `apps/web/src/app/error.tsx`, `apps/web/src/app/(app)/error.tsx` — error UI + retry.
- `apps/web/src/app/(app)/(catalog)/page.tsx` — the catalog page, moved from `(app)/page.tsx` into the `(catalog)` route group.
- `apps/web/src/components/game-cover.tsx` — client cover with load/error states and alt.
- `apps/web/src/components/game-detail-view.tsx`, `game-edit-form.tsx`, `delete-game-button.tsx`, `catalog-filter-bar.tsx`, `re-enrich-control.tsx` — de-templating, focus and alt changes.

# Manual acceptance

1. Throttle the network and hard-reload `/`: the skeleton mirrors the final grid and the layout does not jump.
2. Stop the API and load `/`: the root error boundary renders **Try again**; restarting the API and pressing it reloads the catalog.
3. Open `/games/[id]`: the detail skeleton mirrors the header/cover/record geometry.
4. A slow cover shows the pulse then fades in without moving its tile; a broken cover URL shows the gradient-initial no-cover placeholder.
5. At 375 px the grid is 2 columns (2 / 3 / 4 / 5 across 375 / 768 / 1024 / 1280), the filter bar stacks (the platform chips stay on one line and scroll horizontally inside their own strip, with edge fades; search and sort are full width), the detail cover is capped, and the page has no horizontal scroll.
6. Delete dialog: focus starts on **Cancel**, Tab cycles Cancel↔Delete, Escape returns focus to **Delete game**.
7. Edit disclosure: opening focuses **Title**, Escape closes and focuses **Edit record**.
8. Grid tiles announce each game once; the detail hero and re-enrich preview covers keep non-empty descriptive `alt`; keyboard focus outlines are visible throughout (the shared `:focus-visible` outline).

# Out of scope

- Restyling non-catalog routes; `global-error.tsx`; a web test runner; i18n; pagination/sort redesign.
- `notFound()` and `redirect()` behaviour is unchanged.
