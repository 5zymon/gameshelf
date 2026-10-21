---
type: Feature
title: Collection Statistics
description: The /stats page and GET /stats endpoint - how many games (titles) and physical copies the collection holds, how many games each platform holds, how many games come from each release decade, and how many games wait for platform recognition, 0 included (T-04); or a prompt to import games when it is empty.
tags: [web, ui, api, stats]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-21T10:48:51Z }
---

# Overview

`/stats` is the collection statistics page. Ticket T-01 answers how many games
(titles) and how many physical copies the collection holds. Ticket T-02 adds how
many games each platform holds and how many games are waiting for platform
recognition. Ticket T-03 adds how many games come from each release decade, plus
a separate count of games with no release year. Ticket T-04 makes the "Data
quality" card always visible, so it states the count of games waiting for platform
recognition even when that count is 0. Games are global per instance, so the numbers cover the whole
collection, not one user. The page reads everything from one endpoint,
`GET /stats`, which later stories extend with sibling fields.

# GET /stats

| Method | Path     | Purpose                        | Success             | Errors                              |
| ------ | -------- | ------------------------------ | ------------------- | ----------------------------------- |
| GET    | `/stats` | Collection totals, no filters. | 200 `StatsResponse` | 401 no session; 400 any query param |

```ts
export interface StatsTotals {
  games: number; // count of Game rows (titles)
  copies: number; // sum of Game.copyCount; 0 when there are no games
}
export interface StatsPlatform {
  id: string; // Platform.id
  name: string; // Platform.name
  games: number; // games assigned to this platform, platformUnverified included (0001)
}
export interface StatsDataQuality {
  unverifiedPlatform: number; // games with platformUnverified = true
}
export interface StatsDecade {
  decade: number; // first year of the decade, e.g. 1990 for 1990-1999
  games: number; // games whose releaseYear falls in the decade
}
export interface StatsResponse {
  totals: StatsTotals;
  platforms: StatsPlatform[]; // only platforms with >= 1 game; games desc, then name asc
  dataQuality: StatsDataQuality;
  decades: StatsDecade[]; // only decades with >= 1 game; decade ascending
  noReleaseYear: number; // games with releaseYear = null
}
```

- `totals.games` equals `meta.total` of `GET /games` without filters.
- `StatsService.getStats()` runs its reads in one `prisma.$transaction([...])`, so
  all numbers come from one consistent snapshot: `game.aggregate` (`_count._all`,
  `_sum.copyCount`; a `null` sum for an empty collection is returned as `0`),
  `platform.findMany` for platforms that have at least one game with
  `_count.games`, `game.count({ where: { platformUnverified: true } })`, and
  `game.groupBy({ by: ['releaseYear'], _count: { _all: true } })` for the decades.
- `platforms` lists only platforms with at least one game, sorted in the service by
  `games` descending, then `name` ascending (`localeCompare`). An empty collection
  gives `platforms: []` and `dataQuality.unverifiedPlatform: 0`.
- `decades` lists only decades with at least one game, oldest first (`decade`
  ascending, no zero rows for gaps). The service folds the per-year rows of
  `groupBy` into decades with `decade = Math.floor(year / 10) * 10` and sums their
  counts; `decade` is the first year of the decade (1990 for 1990-1999). The row
  with a `null` release year becomes `noReleaseYear` (0 when absent). An empty
  collection gives `decades: []` and `noReleaseYear: 0`.
- Each `decades[].games` equals the sum of `meta.total` of `GET /games?year=<y>`
  over the decade's ten years, and `sum(decades[].games) + noReleaseYear` equals
  `totals.games`.
- Counting rule (decision 0001): a game with `platformUnverified = true` counts
  under its own platform in `platforms`, and is also counted separately in
  `dataQuality.unverifiedPlatform`. So the platform counts sum to `totals.games`,
  and each `platforms[].games` equals `meta.total` of `GET /games?platformId=<id>`.
- The route sits behind the global `SessionGuard` (no `@Public()`): no session
  gives 401.
- The route binds an intentionally empty `StatsQueryDto` via `@Query()`, so the
  global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`) answers any query
  param with 400. The pipe validates only a bound DTO; a route without `@Query()`
  would accept unknown params.
- Code: `apps/api/src/stats/` (module, controller, service,
  `dto/stats-response.model.ts`, `dto/stats-query.dto.ts`). The web side calls it
  through `api.stats.get` and the server helper `getStats()` (401 gives `null`,
  and the page redirects to `/login`); see [Web API Client](web-api-client.md).

# Page and states

The page is a server component, reached from the **Statistics** link in the main
navigation ([Web Auth UI](web-auth-ui.md)). Strings live in the `stats` namespace
([Internationalization](i18n.md)); numbers are formatted for the active locale.

| State                            | Header                                                                           | Body                                                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading                          | Skeleton blocks shaped like the header                                           | One skeleton tile and one skeleton card each for the platform and decade sections                                                                                      |
| Games in the collection          | h1 "Statistics" and one summary line with both numbers ("128 games, 143 copies") | A single tile for the number of games (the counted item), then the "Games per platform" card, the "Games per release decade" card and the "Data quality" card (always) |
| Empty collection (`games === 0`) | h1 only, no zero summary                                                         | Empty-state card with a short explanation, a primary link to `/import` and a secondary link to `/games/new`; no tiles, no zero values                                  |
| Signed out                       | Redirect to `/login`                                                             | -                                                                                                                                                                      |

Copies appear only in the header summary line; the body counts games. Styling
uses theme token utilities only, so it follows light and dark theme
([Theme](theme.md)).

The sections below appear only in the non-empty branch, each as a card with an
`h2`, in this order:

- **Games per platform** - a `<table>` with one row per entry of `platforms`, in
  API order: platform name, a bar, and the count formatted for the active locale.
  The column headers (platform, share, games) are visually hidden but present for
  screen readers. The bar is an `aria-hidden` inline `<svg>` with a full-width
  track and a value rectangle whose `width` attribute is the share of the largest
  platform's count (the largest is 100%). Every platform is shown, including a
  collection with a single bar. Platform names are data and are never translated.
- **Games per release decade** - a `<table>` built like the platform table, with
  one row per entry of `decades`, oldest first: the decade label, a bar and the
  count formatted for the active locale. The label comes from the message
  `stats.decades.decade`: EN "1990s", PL "lata 1990" (the decade is passed as a
  string, so it is never formatted as "1,990"). Column headers (period, share,
  games) are visually hidden. The largest of all shown rows, including the "No
  year" row, is the 100% bar. Only decades with games are listed. While
  `noReleaseYear` is above zero, a last row "No year" shows that count with the
  same bar style; with zero it is absent. Rows do not link to the catalog (T-05).
- **Data quality** - always shown in the non-empty branch: one plural sentence
  ("3 games are waiting for platform recognition"). With nothing waiting it shows
  0 in the same sentence ("0 games are waiting for platform recognition", PL "0 gier
  czeka na rozpoznanie platformy"). The short note that these games are still
  counted under their assigned platform appears only while
  `dataQuality.unverifiedPlatform` is above zero.

Bar widths use the SVG `width` attribute, never an inline `style`: the production
`style-src` is `'self' 'nonce-...'`, which blocks `style="..."` attributes. There
are no `dark:` variants and no chart library; the bars use the `fill-accent` and
`fill-edge` token utilities.

# Manual acceptance

1. Sign in with games that have several copies. Open **Statistics** from the
   navigation: the header shows the games and the total copies, and the body shows
   one games tile.
2. The copies number appears only in the header.
3. Switch the language between EN and PL: all text and number formatting change.
4. Switch theme: the page stays readable in light and dark.
5. Empty the collection (`npm run db:clear-dev`): the page shows the explanation and
   the **/import** and **/games/new** links, with no zero values.
6. `GET /stats` without a session returns 401; `GET /stats?x=1` with a session
   returns 400; `totals.games` equals `GET /games` `meta.total`.
7. With games on several platforms, "Games per platform" lists each platform with
   its count, largest first, and the largest platform's bar is the full width.
   Each count equals `GET /games?platformId=<id>` `meta.total`, and the counts sum
   to the games number in the header.
8. Mark a game's platform as unverified (`platformUnverified = true`): it stays
   counted under its platform, and "Data quality" shows the count of such games
   with the note. With none, the "Data quality" card shows 0 and no note.
9. Switch the language between EN and PL and between light and dark theme: both
   sections above stay translated and readable.
10. With games from several decades, "Games per release decade" lists each decade
    with games, oldest first, labelled "1990s" (EN) and "lata 1990" (PL). Each
    count equals the sum of `GET /games?year=<y>` `meta.total` over the decade's
    ten years, and the largest row's bar is the full width.
11. With games that have no release year, a last "No year" row shows their count,
    and the decade counts plus that row sum to the games number in the header.
    With none, the row is absent.
12. Switch the language and theme again: the decade section stays translated and
    readable.

# Related

- [Catalog API](catalog-api.md) - `GET /games`, whose `meta.total` equals
  `totals.games` and, filtered by `platformId`, each `platforms[].games`.
- [Manual Add & Copy Count](manual-add-and-copy-count.md) - where `Game.copyCount`
  comes from.
- [Web API Client](web-api-client.md), [Internationalization](i18n.md),
  [Web Auth UI](web-auth-ui.md) - client, strings and navigation.

# Out of scope

Not yet built; later stories add them to the same response and page:

- Further data-quality counts (missing cover, missing `enrichedAt`).
- T-05: links from the numbers to the catalog and new catalog filters.
- Any filter UI or filter query param on `/stats`, and any chart library.
