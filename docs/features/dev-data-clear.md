---
type: Feature
title: Dev Data Clear
description: Dev-only `db:clear-dev` command that deletes all game and import data while keeping accounts, settings and canonical platforms.
tags: [cli, operations, dev]
status: draft
generated: { by: opencode/home-model, at: 2026-10-11T22:30:00Z }
---

# Overview

Testing the photo-import flow repeatedly leaves the development database full of
games, import history and import-created platforms. `db:clear-dev` deletes that
churn in one transaction so a developer can start from a clean catalog without
re-running migrations, re-syncing platforms, or creating an account again.

It is a **development-only** maintenance command, not part of the product.

# Command

```bash
npm run db:clear-dev            # show counts and ask for confirmation
npm run db:clear-dev -- --force # delete without prompting (scripts)
```

The entry point is `apps/api/src/cli/clear-dev.ts`, run with `ts-node` against
`apps/api/tsconfig.json`. It boots
`NestFactory.createApplicationContext(AppModule)`, resolves `PrismaService` and
`ConfigService`, and calls `clearDevData`. Nothing is built first.

Stop `npm run dev` first: the in-process worker may be mid-job on an
`import_jobs` row this command deletes.

# Developer-mode gate

The command runs only when `NODE_ENV === 'development'` (exact match). The value
is read through `ConfigService` after the app context boots, so the root `.env`
is honored — but an existing process env wins, so `NODE_ENV=test npm run
db:clear-dev` is still refused. Any other value, including unset, `test` or
`production`, exits `1` **before any query runs**.

Residual limitation: the gate only inspects `NODE_ENV`. A `.env` that says
`NODE_ENV=development` while `DATABASE_URL` points at a shared or production
database still passes, and with `--force` not even the row counts are shown. The
confirmation header prints the target host and database name so the operator can
see which database is about to be cleared, but nothing verifies it is local.
Check `DATABASE_URL` yourself before running, especially with `--force`.

# What is cleared / kept

| Table                                                   | Action                   | Reason                                                                                            |
| ------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| `recognized_items`, `unrecognized_items`, `import_jobs` | delete                   | Import history points at games and photos; leaving it shows stale progress/attention.             |
| `game_videos`, `game_images`, `games`                   | delete                   | The game content itself.                                                                          |
| `platforms WHERE added_by_import = true`                | delete (aliases cascade) | Artifacts of imports that were never confirmed; they would pollute the next test.                 |
| other `platforms` + their `platform_aliases`            | **keep**                 | Canonical IGDB list from `platforms:sync` and user-confirmed rows; re-syncing costs API calls.    |
| `users`, `sessions`                                     | **keep**                 | The operator stays logged in.                                                                     |
| `llm_settings`                                          | **keep**                 | Holds the encrypted provider key/config; wiping it blocks photo imports.                          |
| `import_queue_state`                                    | **keep**                 | The durable pause (ADR-005); clearing it would silently resume a queue paused for a config error. |

Deletes run in one Prisma `$transaction`, children first:
`recognizedItem`, `unrecognizedItem`, `importJob`, `gameVideo`, `gameImage`,
`game`, then `platform({ where: { addedByImport: true } })`. Games go before
platforms because `Game.platform` has no cascade. Auto-increment ids are not
reset (`DELETE`, not `TRUNCATE`).

Files on disk (covers, gallery images, import photos) are not deleted; they
become unreferenced.

# Confirmation and `--force`

Without `--force`:

- In a terminal, the command prints the target database (host and database name
  only — never the user or password from `DATABASE_URL`) and the per-table row
  counts, then asks `Type "yes" to delete: `. Anything other than `yes`
  (including an empty answer) aborts with exit `0` and deletes nothing — a safe
  dry run.
- Without a terminal, it refuses with exit `1` rather than reading a piped
  answer.

With `--force`, no counts are shown and no prompt is read; the delete runs
immediately.

# Exit codes

| Situation                       | Exit | Message                                                         |
| ------------------------------- | ---- | --------------------------------------------------------------- |
| Cleared                         | `0`  | `Dev data cleared: games=… images=… …` (stdout)                 |
| Prompt declined                 | `0`  | `Aborted; nothing was deleted.` (stdout)                        |
| `NODE_ENV` is not `development` | `1`  | `db:clear-dev only runs with NODE_ENV=development (current: …)` |
| No terminal and no `--force`    | `1`  | `refusing to clear without a terminal; pass --force.`           |
| A query throws                  | `1`  | `Error: <message>`; the transaction rolls back                  |
| Unknown argument                | `1`  | `Unknown argument: <arg>`                                       |

# Out of scope

- Dropping or re-migrating the schema (`prisma migrate reset`).
- Clearing `import_queue_state`.
- Clearing `llm_settings`, users or sessions.
- Deleting cover/gallery/import files on disk.
- A separate `--dry-run` flag (answering `no` at the prompt covers the dry run).
