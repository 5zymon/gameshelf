---
type: Feature
title: Catalog CSV Export
description: The /export page and GET /export/csv endpoint - download the whole catalog as one RFC 4180 CSV file named gameshelf-YYYY-MM-DD.csv, one row per game, 12 English columns, UTF-8 without BOM, no formula-injection guard (T-06).
tags: [web, ui, api, export]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-22T12:00:00Z }
---

# Overview

Ticket T-06 lets the owner download the whole catalog as one CSV file from the
**Export** page (`/export`). The file has one row per game, so it opens in a
spreadsheet. Games are global per instance, so the file covers the whole
collection, not one user. The file is built in memory by one endpoint,
`GET /export/csv`; the browser reaches it as `/api/export/csv` through the
same-origin rewrite.

Honest scope of this version:

- English column headers, whatever the UI language.
- UTF-8 **without** a byte-order mark (BOM).
- **No** formula-injection guard: a title that starts with `=`, `+`, `-`, `@`, a
  tab or `\r` is written as is and can run as a formula in a spreadsheet. T-09
  adds the guard and must merge before the export reaches any user's instance.
- The whole catalog only: no filter and no query parameter.

# GET /export/csv

| Method | Path          | Purpose                                | Success   | Errors                              |
| ------ | ------------- | -------------------------------------- | --------- | ----------------------------------- |
| GET    | `/export/csv` | The whole catalog as a CSV attachment. | 200 `CSV` | 401 no session; 400 any query param |

| Aspect                | Value                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| `Content-Type`        | `text/csv; charset=utf-8`                                                    |
| `Content-Disposition` | `attachment; filename="gameshelf-YYYY-MM-DD.csv"`                            |
| `Cache-Control`       | `no-store`                                                                   |
| Body                  | Header row, then one row per game; lines end with `\r\n`, including the last |

- The route sits behind the global `SessionGuard` (no `@Public()`): no session
  gives 401. The file holds the whole catalog, so it must never be public.
- The route binds an intentionally empty `ExportCsvQueryDto` via `@Query()`, so
  the global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`) answers any
  query param with 400, like `GET /stats`.
- The controller sets the headers through `@Res({ passthrough: true })` and
  returns the string. The filename is built by the server from a date, with no
  user input, so `Content-Disposition` cannot be injected.
- Code: `apps/api/src/export/` (module, controller, service, `csv.ts`,
  `dto/export-csv-query.dto.ts`). `ExportService.catalogCsv()` runs one
  `prisma.game.findMany` with `select`; `csv.ts` is a pure module (`csvCell`,
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
included like any other, under their assigned platform.

The row count equals `totals.games` of `GET /stats` and `meta.total` of
`GET /games` without filters.

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
empty.

# The /export page

The page is a server component (`apps/web/src/app/(app)/export/page.tsx`,
`dynamic = 'force-dynamic'`), reached from the **Export** link in the main
navigation, between **Statistics** and **Import** ([Web Auth UI](web-auth-ui.md)).
It calls `getStats()` (401 gives `null`, and the page redirects to `/login`; see
[Collection Statistics](stats.md)). Strings live in the `catalogExport`
namespace ([Internationalization](i18n.md)).

| State                            | Content                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Games in the collection          | h1 "Export", a one-line description, a "Range" fieldset with one pre-selected radio "Whole catalog", and a "Download CSV" button |
| Empty collection (`games === 0`) | The same, plus the notice "Your collection is empty. The file will contain only the column headers."; the button stays enabled   |
| Signed out                       | Redirect to `/login`                                                                                                             |

- The "Range" radio group has a single option (`name="range"`, `value="all"`,
  `defaultChecked`), so a later story can add "One platform" to the same group.
- "Download CSV" is a plain anchor, `<a href="/api/export/csv" download>`, not
  `next/link`: it is a file, not a route. The same-origin rewrite carries the
  `gameshelf_session` cookie, and the browser takes the filename from
  `Content-Disposition`. No client-side fetch or blob is involved.
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

# Related

- [Collection Statistics](stats.md) - `GET /stats`, whose `totals.games` equals
  the number of data rows and which the page uses for the empty check.
- [Catalog API](catalog-api.md) - `GET /games`, whose `meta.total` equals the
  number of data rows.
- [Web Auth UI](web-auth-ui.md), [Internationalization](i18n.md) - navigation and
  strings.

# Out of scope

Not built; sibling stories add them:

- T-07: export of one platform only (a `platformId` parameter, a second radio
  option and a platform select).
- T-08: UTF-8 BOM so spreadsheets detect the encoding.
- T-09: formula-injection guard for cells starting with `=`, `+`, `-`, `@`, tab or
  `\r`.
- T-10: column headers in the UI language.
- Streaming the file if collections grow far past a few thousand games.
