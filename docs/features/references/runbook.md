---
type: Runbook
title: Operator Runbook
description: Thin index of the operator's setup, day-to-day, and incident procedures, cross-linking the sections of the root README that actually run the app.
tags: [operations, runbook, backup, cli]
status: draft
generated: { by: opencode/home-model, at: 2026-10-08T14:34:44Z }
---

# Overview

This is a thin **runbook**, not a second copy of the operator guide. It indexes
the sections of the root [`README.md`](../../../README.md) that a GameShelf
operator actually runs — setup, account management, backup/restore, and health
checks — so the day-to-day and incident procedures are one click apart. The
README is the single source of truth for every command and its expected output;
this document only points at it.

# What to do when

| Situation                                       | Read (README section)                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| First install, from a clean clone               | [Setup](../../../README.md#setup) — one command (`npm run setup`) or the manual fallback                  |
| Start / stop the app                            | [Running](../../../README.md#running) — `npm run dev` (API :3001, web :3000)                              |
| Create or recover an account (CLI)              | [Accounts and registration](../../../README.md#accounts-and-registration) — `user:create` / `user:passwd` |
| Back up the library                             | [Backup and restore](../../../README.md#backup-and-restore) — logical `mysqldump`                         |
| Restore after data loss, rebuild, or a new host | [Backup and restore](../../../README.md#backup-and-restore) — the restore procedure                       |
| Post-setup or post-incident health sweep        | [Operational checks](../../../README.md#operational-checks)                                               |
| Configure LLM / IGDB / MobyGames credentials    | [External services (LLM, IGDB, MobyGames)](../../../README.md#external-services-llm-igdb-mobygames)       |
| What is (and is not) supported                  | [Scope](../../../README.md#scope) — deployment is out of scope                                            |

# Related feature docs

The CLI and bootstrap behaviour are specified in the bundle:

- [User CLI](/user-cli.md) — the `user:create` / `user:passwd` commands and how the password is entered (never as an argument).
- [First-run Setup](/first-run-setup.md) — the one-time `POST /setup` that creates the first account and is permanently disabled once one exists.
- [Queue Pause on Configuration Error](/queue-pause-on-config-error.md) — why a rejected LLM/IGDB/MobyGames credential pauses the photo-import queue and how to resume it.

# Notes

- The **durable data directory** check (ADR-001) is a human decision the app cannot perform for you; it is the last row of [Operational checks](../../../README.md#operational-checks).
- Backups land in `backups/` (gitignored). Never back up `gameshelf_shadow` / `gameshelf_test`, and back up the Redis queue only to preserve in-flight jobs (it is ephemeral by design, ADR-002).
- A restore loads a dump into a **fresh, empty** `gameshelf` database; the committed Prisma migrations are not needed for a restore because the dump already contains the schema.
