---
type: Runbook
title: Operator Runbook
description: Thin index of the operator's setup, day-to-day, and incident procedures, cross-linking the sections of the reference guides that actually run the app.
tags: [operations, runbook, backup, cli]
status: draft
generated: { by: opencode/home-model, at: 2026-10-08T14:34:44Z }
---

# Overview

This is a thin **runbook**, not a second copy of the operator guide. It indexes
the sections of the reference guides — [Installation & First Run](installation.md),
[Configuration & External Services](configuration.md) and
[Database, Backups & Operational Checks](operations.md) — that a
GameShelf operator actually runs, so the day-to-day and incident procedures are
one click apart. The guides are the single source of truth for every command
and its expected output; this document only points at them.

# What to do when

| Situation                                       | Read                                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| First install, from a clean clone               | [Setup](installation.md#setup) — one command (`npm run setup`) or the manual fallback                            |
| Start / stop the app                            | [Running](installation.md#running) — `npm run dev` (API on `API_PORT`, web on `WEB_PORT`; default :3001 / :3000) |
| Create or recover an account (CLI)              | [Accounts and registration](installation.md#accounts-and-registration) — `user:create` / `user:passwd`           |
| Back up the library                             | [Backup and restore](operations.md#backup-and-restore) — logical `mysqldump`                                     |
| Restore after data loss, rebuild, or a new host | [Restore (the critical procedure)](operations.md#restore-the-critical-procedure) — the restore procedure         |
| Post-setup or post-incident health sweep        | [Operational checks](operations.md#operational-checks)                                                           |
| Configure LLM / IGDB / MobyGames credentials    | [External services (LLM, IGDB, MobyGames)](configuration.md#external-services-llm-igdb-mobygames)                |
| Change a port, host or secret                   | [Environment variables](configuration.md#environment-variables)                                                  |
| What is (and is not) supported                  | [Scope](installation.md#scope) — deployment is out of scope                                                      |

# Related feature docs

The CLI and bootstrap behaviour are specified in the bundle:

- [User CLI](../user-cli.md) — the `user:create` / `user:passwd` commands and how the password is entered (never as an argument).
- [First-run Setup](../first-run-setup.md) — the one-time `POST /setup` that creates the first account and is permanently disabled once one exists.
- [Queue Pause on Configuration Error](../queue-pause-on-config-error.md) — why a rejected LLM/IGDB/MobyGames credential pauses the photo-import queue and how to resume it.

# Notes

- The **durable data directory** check (ADR-001) is a human decision the app cannot perform for you; it is the last row of [Operational checks](operations.md#operational-checks).
- Backups land in `backups/` (gitignored). Never back up `gameshelf_shadow` / `gameshelf_test`; import jobs are part of the MySQL backup.
- A restore loads a dump into a **fresh, empty** `gameshelf` database; the committed Prisma migrations are not needed for a restore because the dump already contains the schema.
