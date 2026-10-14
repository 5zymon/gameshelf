---
type: Feature
title: Dev Seed
description: Development-only `db:seed` command that creates a known QA account plus sample platforms and games, idempotently.
tags: [cli, operations, dev, qa]
status: draft
generated: { by: opencode/home-model, at: 2026-10-12T12:00:00Z }
---

# Overview

Repeatedly testing the app against a fresh or cleared database means
re-creating an account and re-adding sample games every time. `db:seed` seeds
a known QA account, three canonical platforms and six sample games in one
command, so a developer (or an agent) can log in and exercise the catalog
filters immediately.

It is a **development-only** maintenance command, not part of the product. It
pairs with [Dev Data Clear](dev-data-clear.md): `db:clear-dev` empties the
catalog, `db:seed` fills it with a known baseline.

# Command

```bash
npm run db:seed
```

The entry point is `apps/api/src/cli/seed.ts`, run with `ts-node` against
`apps/api/tsconfig.json`. It boots
`NestFactory.createApplicationContext(AppModule)`, resolves `ConfigService`,
`PrismaService`, `UsersService` and `PlatformsService`, and calls
`seedDevData`. Nothing is built first. The command takes no arguments; any
argument prints `Usage: npm run db:seed` and exits `1`.

# Developer-mode gate

The command runs only when `NODE_ENV === 'development'` (exact match). The
value is read through `ConfigService` after the app context boots, so the root
`.env` is honored — but an existing process env wins, so `NODE_ENV=test npm run
db:seed` is still refused. Any other value, including unset, `test` or
`production`, exits `1` **before the seed writes anything** (module init —
Prisma connect — does run first).

Residual limitation: the gate only inspects `NODE_ENV`. A `.env` that says
`NODE_ENV=development` while `DATABASE_URL` points at a shared or production
database still passes. The header prints the target host and database name so
the operator can see which database is being seeded, but nothing verifies it is
local. Check `DATABASE_URL` yourself before running.

# What is seeded

| Item                     | Value / rule                                                                                                                            | Idempotency key                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| QA user                  | `qa@gameshelf.local` / `gameshelf-qa-password`, created through `UsersService` (Argon2id hash)                                          | `users.email` — re-run resets the password to the documented value |
| `PC (Microsoft Windows)` | abbreviation `PC`, IGDB id 6                                                                                                            | `platforms.name` (matched by `findPlatformMatch`)                  |
| `PlayStation 5`          | abbreviation `PS5`, platform family 1, IGDB id 167                                                                                      | `platforms.name` (matched by `findPlatformMatch`)                  |
| `Nintendo Switch`        | abbreviation `Switch`, platform family 5, IGDB id 130                                                                                   | `platforms.name` (matched by `findPlatformMatch`)                  |
| 6 sample games           | `Hades`, `Disco Elysium (The Final Cut)`, `Elden Ring`, `Astro Bot`, `Mario Kart 8 Deluxe`, `The Legend of Zelda: Tears of the Kingdom` | `isSameGameIdentity` (title + platform + edition, `MANUAL`)        |

The platforms use IGDB-canonical names and ids, so a later (or earlier)
`platforms:sync` matches them by name and reconciles them instead of creating
duplicates. The games are `MANUAL` rows with varied platforms, years,
publishers and genres (to exercise the catalog filters), one edition, one
`copyCount: 2` and one multiplayer title. They carry no covers, summary or
rating — manual rows must not pretend to come from IGDB.

# Re-run and reset behaviour

- **Password reset.** If the QA user already exists, its password is reset to
  the documented value through `UsersService.setPassword`. Existing sessions
  are not revoked.
- **Platform reuse.** Each seed platform is matched against the existing
  platforms by name (the same `findPlatformMatch` the platform sync uses, so
  a renamed platform is still reused via its alias). Only unmatched names are
  created, through `PlatformsService.createCanonical` (which reserves a slug).
- **Game skip.** A seed game is skipped when a game with the same identity
  already exists on the same platform (`isSameGameIdentity`: normalized title,
  platform, edition). A seed game a user edited (title or platform changed) is
  therefore re-created on the next run.
- **Not transactional.** The writes are deliberately not wrapped in a
  transaction: every step is idempotent, so re-running after a partial failure
  completes the seed.

For a fully clean catalog, clear first, then seed:

```bash
npm run db:clear-dev -- --force && npm run db:seed
```

# Interaction with first-run setup and `platforms:sync`

- **First-run setup closes.** Seeding creates a user, and [first-run
  setup](first-run-setup.md) is permanently disabled once any user exists.
  Do not seed a database you still need to test `/setup` on.
- **`platforms:sync` reconciles.** The seeded platforms carry IGDB-canonical
  names and ids, so the sync matches them by name and updates their canonical
  fields instead of creating duplicates. A platform the user renamed is still
  reused via alias matching; an ambiguous name (two rows sharing a match key)
  creates a new row.

# Exit codes

| Situation                       | Exit | Message                                                                   |
| ------------------------------- | ---- | ------------------------------------------------------------------------- |
| Seeded                          | `0`  | `Dev data seeded: user=… platformsCreated=… …` + `QA account: …` (stdout) |
| `NODE_ENV` is not `development` | `1`  | `db:seed only runs with NODE_ENV=development (current: …)`                |
| A query throws                  | `1`  | `Error: <message>`; already-seeded rows stay (re-run to finish)           |
| Any argument                    | `1`  | `Usage: npm run db:seed`                                                  |

# Out of scope

- Import jobs, recognized/unrecognized items, LLM settings, covers or images.
- A `--fresh` flag (use `db:clear-dev -- --force` first).
- A Prisma `migrations.seed` hook.
- Multiple QA accounts or roles.
