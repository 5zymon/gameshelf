---
type: Feature
title: Collection Statistics
description: The /stats page and GET /stats endpoint - how many games (titles) and how many physical copies the collection holds, or a prompt to import games when it is empty.
tags: [web, ui, api, stats]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-20T09:32:30Z }
---

# Overview

`/stats` is the collection statistics page. This first slice (ticket T-01) answers
one question: how many games (titles) and how many physical copies does the
collection hold. Games are global per instance, so the numbers cover the whole
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
export interface StatsResponse {
  totals: StatsTotals;
}
```

- `totals.games` equals `meta.total` of `GET /games` without filters.
- One `prisma.game.aggregate` call (`_count._all`, `_sum.copyCount`); a `null` sum
  (empty collection) is returned as `0`.
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

| State                            | Header                                                                           | Body                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Loading                          | Skeleton blocks shaped like the header                                           | One skeleton tile                                                                                                                     |
| Games in the collection          | h1 "Statistics" and one summary line with both numbers ("128 games, 143 copies") | A single tile for the number of games (the counted item)                                                                              |
| Empty collection (`games === 0`) | h1 only, no zero summary                                                         | Empty-state card with a short explanation, a primary link to `/import` and a secondary link to `/games/new`; no tiles, no zero values |
| Signed out                       | Redirect to `/login`                                                             | -                                                                                                                                     |

Copies appear only in the header summary line; the body counts games. Styling
uses theme token utilities only, so it follows light and dark theme
([Theme](theme.md)).

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

# Related

- [Catalog API](catalog-api.md) - `GET /games`, whose `meta.total` equals
  `totals.games`.
- [Manual Add & Copy Count](manual-add-and-copy-count.md) - where `Game.copyCount`
  comes from.
- [Web API Client](web-api-client.md), [Internationalization](i18n.md),
  [Web Auth UI](web-auth-ui.md) - client, strings and navigation.

# Out of scope

Not yet built; later stories add them to the same response and page:

- T-02 to T-04: platform, decade and data-quality aggregates.
- T-05: links from the numbers to the catalog and new catalog filters.
- Any filter UI or filter query param on `/stats`, and any chart library.
