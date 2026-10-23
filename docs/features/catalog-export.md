---
type: Feature
title: Catalog CSV Export
description: The /export page and GET /export/csv endpoint - download the whole catalog (T-06) or one platform's games (T-07) as one RFC 4180 CSV file named gameshelf-YYYY-MM-DD.csv, one row per game, 12 English columns, UTF-8 without BOM, no formula-injection guard.
tags: [web, ui, api, export]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-22T15:00:00Z }
---

# Overview

Ticket T-06 lets the owner download the whole catalog as one CSV file from the
**Export** page (`/export`); ticket T-07 adds a second range, **One platform**,
which downloads only the games of the chosen platform. The file has one row per
game, so it opens in a spreadsheet. Games are global per instance, so the file
covers the whole collection (or one platform of it), not one user. The file is
built in memory by one endpoint, `GET /export/csv`, with an optional
`platformId` query parameter; the browser reaches it as `/api/export/csv`
through the same-origin rewrite.

Honest scope of this version:

- English column headers, whatever the UI language.
- UTF-8 **without** a byte-order mark (BOM).
- **No** formula-injection guard: a title that starts with `=`, `+`, `-`, `@`, a
  tab or `\r` is written as is and can run as a formula in a spreadsheet. T-09
  adds the guard and must merge before the export reaches any user's instance.
- Two ranges only: the whole catalog or one platform. `platformId` is the only
  query parameter: no year, genre or multi-platform filter.

# GET /export/csv

| Method | Path          | Purpose                                                | Success   | Errors                                                                    |
| ------ | ------------- | ------------------------------------------------------ | --------- | ------------------------------------------------------------------------- |
| GET    | `/export/csv` | The whole catalog or one platform as a CSV attachment. | 200 `CSV` | 401 no session; 400 invalid `platformId` or any other param; 404 platform |

| Request                                                      | Response                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| no query                                                     | `200`, the whole catalog (unchanged from T-06)                                                            |
| `?platformId=<uuid v7>`, the platform exists                 | `200`, the header row and only the games with that `platformId`; the header row only when it has no games |
| `?platformId=<uuid v7>`, no such platform                    | `404` `Platform with id <id> not found`                                                                   |
| `?platformId=x`, a repeated `platformId`, or any other param | `400` (validation)                                                                                        |
| no session                                                   | `401` (global `SessionGuard`)                                                                             |

`Content-Type`, `Content-Disposition` (with `gameshelf-YYYY-MM-DD.csv`) and
`Cache-Control` are identical for both ranges: the filename does not name the
platform.

| Aspect                | Value                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| `Content-Type`        | `text/csv; charset=utf-8`                                                    |
| `Content-Disposition` | `attachment; filename="gameshelf-YYYY-MM-DD.csv"`                            |
| `Cache-Control`       | `no-store`                                                                   |
| Body                  | Header row, then one row per game; lines end with `\r\n`, including the last |

- The route sits behind the global `SessionGuard` (no `@Public()`): no session
  gives 401. The file holds the whole catalog, so it must never be public.
- The route binds `ExportCsvQueryDto` via `@Query()`. Its only field is the
  optional `platformId`, validated like `PlatformIdParamDto`: lower-cased
  (`lowercaseId`), then `@IsUUID('7')`, so an upper-case id is accepted. The
  global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`) answers any
  other query param, a malformed id and a repeated `platformId` with 400.
- `ExportService.catalogCsv(platformId?)`: without an id it runs the T-06 query
  with no `where`. With an id it first checks the platform exists
  (`prisma.platform.findUnique`, `null` gives `NotFoundException`), then runs the
  same `findMany` with `where: { platformId }`. Select, order and row mapping are
  unchanged.
- The controller sets the headers through `@Res({ passthrough: true })` and
  returns the string. The filename is built by the server from a date, with no
  user input, so `Content-Disposition` cannot be injected.
- Code: `apps/api/src/export/` (module, controller, service, `csv.ts`,
  `dto/export-csv-query.dto.ts`). `ExportService.catalogCsv()` runs one
  `prisma.game.findMany` with `select` (plus one `platform.findUnique` for a
  single platform); `csv.ts` is a pure module (`csvCell`,
  `toCsv`) with no Nest or Prisma imports.

# Columns

Fixed English headers, in this order:

| Header         | Value                                                              | Empty when                |
| -------------- | ------------------------------------------------------------------ | ------------------------- |
| `Title`        | `title`                                                            | never                     |
| `Platform`     | `platform.name`                                                    | never                     |
| `Edition`      | `edition`                                                          | null                      |
| `Year`         | `releaseYear`                                                      | null                      |
| `Publisher`    | `publisher`                                                        | null                      |
| `Genre`        | `genre`                                                            | null                      |
| `Player count` | `playerCount`                                                      | null                      |
| `Copy count`   | `copyCount`                                                        | never                     |
| `Rating`       | `Math.round(rating)`: a whole number, no decimal separator         | null                      |
| `Source`       | `IGDB` is `IGDB`, `MobyGames` is `MobyGames`, `MANUAL` is `manual` | never                     |
| `IGDB link`    | `igdbUrlFor(game)` from `games/game-detail.mapper.ts`              | `igdbUrlFor` returns null |
| `Date added`   | `createdAt` as `YYYY-MM-DD`                                        | never                     |

Rows are ordered by title ascending, then platform name ascending, then `id`
ascending, so the output is deterministic. Games with an unverified platform are
included like any other, under their assigned platform. This holds for the
single-platform range too: a game with `platformUnverified = true` is exported
with the platform it is assigned to and is never excluded or offered as a
separate option (decision
`../gameshelf-context/docs/decisions/0001-count-unverified-platform-games-under-their-platform.md`,
in the sibling context repository).

The row count equals `totals.games` of `GET /stats` and `meta.total` of
`GET /games` without filters. With `platformId` it equals that platform's
`gameCount` in `GET /platforms`.

# Encoding rules

- RFC 4180: a value is wrapped in double quotes when it contains `,`, `"`, `\r`
  or `\n`; inner double quotes are doubled. Any other value is written as is. A
  null value is an empty cell.
- Cells are joined by `,`; lines are joined by `\r\n`, with a trailing `\r\n`
  after the last row. A title with a newline therefore spans two physical lines
  inside one quoted cell, so a reader must not split the body on `\n`.
- Encoding is UTF-8 with no BOM. A spreadsheet that guesses the encoding may
  show non-ASCII characters wrongly until T-08 adds the BOM.
- `csvCell` and `toCsv` in `csv.ts` are the seams where T-09 (prefix) and T-08
  (BOM) will plug in.

# Dates and time zone

The filename and the `Date added` column use one helper that formats a `Date` as
`YYYY-MM-DD` in the **server's local time zone**, not UTC. The controller passes
`new Date()` for the filename (`exportFilename(date)`); the service never reads
the clock. A game added shortly after local midnight therefore shows the local
day, and the filename shows the day of the download on the server.

# Empty collection

With no games the endpoint still answers 200 with the header row only
(`Title,Platform,...,Date added\r\n`), and `/export` says the collection is
empty. The same rule holds for a known platform with no games:
`?platformId=<id>` answers 200 with the header row only. The **page** is
stricter there: it blocks the download and says there is nothing to export for
that platform (see below).

# The /export page

The page is a server component (`apps/web/src/app/(app)/export/page.tsx`,
`dynamic = 'force-dynamic'`), reached from the **Export** link in the main
navigation, between **Statistics** and **Import** ([Web Auth UI](web-auth-ui.md)).
It calls `getStats()` (401 gives `null`, and the page redirects to `/login`; see
[Collection Statistics](stats.md)), then `getPlatforms()`, and passes the
platforms and `totals.games` to the client component `CatalogExportForm`
(`apps/web/src/components/catalog-export-form.tsx`). Strings live in the
`catalogExport` namespace ([Internationalization](i18n.md)). The pure helpers
`exportPlatforms` and `exportCsvHref` are in `apps/web/src/lib/catalog-export.ts`.

The "Range" fieldset has two radios, `name="range"`: "Whole catalog"
(`value="all"`, the default) and "One platform" (`value="platform"`). "One
platform" is disabled when the platform list is empty. Below it a labelled
"Platform" select is enabled only while "One platform" is selected and defaults
to the first platform in the list; options show the platform name only.

**Which platforms the select lists.** The same platforms as the default
`/platforms` view (`inDefaultView` in `apps/web/src/lib/platforms.ts`): platforms
with games, unreviewed imports and custom platforms, in the order
`GET /platforms` returns them. Reference platforms with no games and hidden
platforms (except unreviewed imports) are not listed. This keeps the two pages consistent: a platform the owner can
see on `/platforms` is one they can export. A listed platform can still have no
games (an import or custom platform), which the control states below handle.

| Range         | Condition                  | Notice                                                                     | Control                                                          |
| ------------- | -------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Whole catalog | `totals.games > 0`         | none                                                                       | `<a href="/api/export/csv" download>`                            |
| Whole catalog | `totals.games === 0`       | "Your collection is empty. The file will contain only the column headers." | the same anchor (header-only file)                               |
| One platform  | selected `gameCount > 0`   | none                                                                       | `<a href="/api/export/csv?platformId=<id>" download>`            |
| One platform  | selected `gameCount === 0` | "There is nothing to export for {platform}."                               | `<button type="button" disabled>` with the same label, no `href` |
| Signed out    | not applicable             | not applicable                                                             | redirect to `/login`                                             |

- The notice is a `<p role="status">`, so a screen reader announces it when the
  choice changes.
- "Download CSV" is a plain anchor, not `next/link`: it is a file, not a route.
  `exportCsvHref(platformId?)` builds `/api/export/csv`, or
  `/api/export/csv?platformId=<encoded id>`. The same-origin rewrite carries the
  `gameshelf_session` cookie, and the browser takes the filename from
  `Content-Disposition`. No client-side fetch or blob is involved.
- The disabled button uses the primary button classes plus
  `disabled:cursor-not-allowed disabled:opacity-60`; it has no `href`, so
  nothing downloads.
- Styling uses theme token utilities only, so it follows light and dark theme
  ([Theme](theme.md)). There are no `dark:` variants and no inline `style`
  attributes (the production CSP blocks them).

# Manual acceptance

1. Sign in with games in the catalog. Open **Export** from the navigation: the
   page shows the "Range" group with "Whole catalog" selected and a **Download
   CSV** button.
2. Click the button: the browser saves `gameshelf-YYYY-MM-DD.csv` with today's
   date.
3. Open the file in a spreadsheet: the 12 columns appear in the order of the
   column table, with one row per game, and `Rating` is a whole number.
4. The number of data rows equals `GET /games` `meta.total` and `GET /stats`
   `totals.games`. A title with a comma, a quote or a newline stays in one cell.
5. Empty the collection (`npm run db:clear-dev`): the page shows the empty notice,
   the button still downloads, and the file holds only the header row.
6. Switch the language between EN and PL: the page text changes, the file's
   headers stay English. Switch theme: the page stays readable in light and dark.
7. `GET /export/csv` without a session returns 401; `GET /export/csv?x=1` with a
   session returns 400.
8. One platform: choose "One platform", pick a platform with games and click
   **Download CSV**. The file is named `gameshelf-YYYY-MM-DD.csv`, the number of
   data rows equals that platform's `gameCount` in `GET /platforms`, and every
   `Platform` cell is that platform's name. A game with an unverified platform
   assigned to it is among the rows.
9. Empty platform: with a custom or import platform that has no games, choose
   "One platform" and pick it. The page says "There is nothing to export for
   <platform>." and the button is disabled, so no file downloads.
   `GET /export/csv?platformId=<its id>` still returns 200 with the header row
   only.
10. `GET /export/csv?platformId=<random uuid v7>` returns 404, `?platformId=x`
    and a repeated `platformId` return 400.

# Related

- [Collection Statistics](stats.md) - `GET /stats`, whose `totals.games` equals
  the number of data rows and which the page uses for the empty check.
- [Catalog API](catalog-api.md) - `GET /games`, whose `meta.total` equals the
  number of data rows.
- [Web Auth UI](web-auth-ui.md), [Internationalization](i18n.md) - navigation and
  strings.

# Out of scope

Not built; sibling stories add them:

- T-08: UTF-8 BOM so spreadsheets detect the encoding.
- T-09: formula-injection guard for cells starting with `=`, `+`, `-`, `@`, tab or
  `\r`.
- T-10: column headers in the UI language.
- Streaming the file if collections grow far past a few thousand games.
