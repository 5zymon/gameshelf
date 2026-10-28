---
type: Runbook
title: Database, Backups & Operational Checks
description: MySQL 8.4/utf8mb4 setup, the gameshelf-mysql-data volume, Prisma migrations, mysqldump backup and restore, read-only health checks, and the Redis-era upgrade.
tags: [operations, database, mysql, backup, runbook]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-14T11:52:50.449Z }
---

# Overview

Day-to-day and incident procedures for the one piece of durable state, the `gameshelf` MySQL database.

# Database (local dev)

GameShelf uses **MySQL 8.4** with `utf8mb4` / `utf8mb4_0900_ai_ci` (ADR-001 — game titles contain CJK and accented characters; `latin1`/`utf8mb3` would corrupt them).

## Starting the database

Docker Compose is a **convenience, not a dependency**: the app only needs a MySQL server reachable at the host and port in `DATABASE_URL`. A system-installed MySQL 8.4 configured with the same charset works identically.

```bash
docker compose up -d mysql     # starts the pinned mysql:8.4
docker compose ps              # wait until the service is "healthy"
```

## Confirming the character set

```bash
docker compose exec mysql mysql --default-character-set=utf8mb4 \
  -ugameshelf -pgameshelf \
  -e "SHOW VARIABLES LIKE 'character_set%'; SHOW VARIABLES LIKE 'collation_server';"
```

Expected (abridged):

```
character_set_client      utf8mb4
character_set_connection  utf8mb4
character_set_database    utf8mb4
character_set_results     utf8mb4
character_set_server      utf8mb4
collation_server          utf8mb4_0900_ai_ci
```

Round-trip check — accented Latin and CJK must come back byte-identical:

```bash
docker compose exec mysql mysql --default-character-set=utf8mb4 \
  -ugameshelf -pgameshelf gameshelf -e "
  CREATE TABLE _charset_check (id INT PRIMARY KEY, title VARCHAR(255));
  INSERT INTO _charset_check VALUES (1,'Pokémon'),(2,'ポケットモンスター'),(3,'Świąteczna edycja');
  SELECT id,title FROM _charset_check;
  DROP TABLE _charset_check;"
```

(The `mysql` CLI prints a password-on-command-line warning on stderr; that is expected.)

## Persistent data directory

The data directory is a **Docker named volume** — `gameshelf-mysql-data`, declared in `docker-compose.yml` — Docker-managed storage on the host, **not** an ephemeral container path and **not** a bind mount into this repository. Recreating the container never loses data. The application cannot verify that this volume sits on durable storage — that is a human check.

To reset the dev database completely (destructive — it deletes the volume):

```bash
docker compose down -v
docker compose up -d mysql
```

**Coming from the old bind-mounted `./data/mysql`?** The volume starts empty and this repository's directory is no longer read. Keep the old data by dumping it out once and loading it into the volume, or start fresh:

```bash
docker run -d --name gameshelf-bindmount -v "$PWD/data/mysql":/var/lib/mysql mysql:8.4
PW=$(grep '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2)
docker exec gameshelf-bindmount sh -c "until mysqladmin ping -uroot -p'$PW' --silent; do sleep 1; done; mysqldump -uroot -p'$PW' --single-transaction --routines --triggers --no-tablespaces gameshelf" > backups/gameshelf-bindmount.sql
docker rm -f gameshelf-bindmount
```

Then load the dump with the [restore procedure](#restore-the-critical-procedure) (steps 3–6). Do **not** copy the old directory into the volume file by file: on macOS and Windows the bind mount was a case-insensitive filesystem, so MySQL served it with `lower_case_table_names=2`, and the volume (like CI, `0`) refuses that data dictionary. A logical dump moves the data cleanly.

Note: the MySQL image creates the database and user only on **first** initialization (empty volume). Changing `MYSQL_USER`/`MYSQL_PASSWORD` in `.env` later has no effect until you reset.

## Migrations (Prisma)

Prisma is the data-access layer (ADR-003). The schema lives at `apps/api/prisma/schema.prisma`, and every schema change is captured as a committed migration under `apps/api/prisma/migrations/`. Because the migrations are in git, the schema is fully rebuildable from a clean clone — the container filesystem is disposable (ADR-001).

| Command              | Prisma command          | When to use                             |
| -------------------- | ----------------------- | --------------------------------------- |
| `npm run db:migrate` | `prisma migrate dev`    | Local development (uses the shadow DB)  |
| `npm run db:deploy`  | `prisma migrate deploy` | Durable environments (apply migrations) |

**`prisma db push` is forbidden outside throwaway experiments.** It syncs the schema directly and bypasses the migration history, so it must never be used in a durable environment.

The generated Prisma client is a **build artifact**: it is written to `apps/api/src/generated/` (gitignored) and regenerated automatically by `npm run build` — never commit it.

The **shadow database** (`gameshelf_shadow`) is created by `docker/mysql-init/01-prisma-shadow.sql` on **first initialization only**, and is required by `prisma migrate dev` (local work). The **test database** (`gameshelf_test`, used by the e2e tier — see [Testing](development.md#testing)) is created the same way by `docker/mysql-init/02-test-database.sql`. To change either you must reset the volume: `docker compose down -v`.

**Character set:** the `?charset=utf8mb4` suffix in `DATABASE_URL` is declarative — Prisma's MySQL connector does not parse it. The real enforcement is threefold: the migration engine connects with `utf8mb4` (MySQL ≥ 5.5.3), every generated table declares `DEFAULT CHARACTER SET utf8mb4`, and the server runs with `--character-set-server=utf8mb4` (see [Confirming the character set](#confirming-the-character-set)).

# Upgrading from Redis

Only for installs created before [ADR-005](../adr-005-mysql-photo-import-queue.md) (2026-10-12) that still run the retired Redis service.

An existing install no longer needs Redis. Apply the migration, then remove the
retired service and its data directory:

```bash
npm run db:deploy
docker compose down --remove-orphans && rm -rf data/redis
```

The migration backfills every `queued`/`processing` job to runnable, so jobs that
were waiting in, or running on, the old Redis queue are processed on the next
start.

# Backup and restore

The only durable, user-created data is the **`gameshelf` MySQL database**
(library, users, sessions, LLM settings, import history). Everything else is
rebuildable or ephemeral:

- **Schema** — fully rebuildable from the committed Prisma migrations (ADR-003);
  you back up _data_, never schema.
- **`gameshelf_shadow` / `gameshelf_test`** — disposable; never back them up.
- **Import jobs / queue** — part of the `gameshelf` MySQL database (ADR-005):
  `import_jobs`, `recognized_items` and `unrecognized_items` are backed up with it.
- **Cover cache** (`COVERS_DIR`, default `covers/` in the repository root) —
  re-downloadable via `npm run covers:redownload`.

> **⚠️ ADR-001 — the app cannot verify your data directory is durable.** GameShelf
> assumes the MySQL data directory is on durable storage, but it **cannot check
> this itself** — that is a human check. Confirm the `gameshelf-mysql-data`
> Docker volume (or your system MySQL's data dir) is on real, backed-up storage,
> not an ephemeral container layer, tmpfs, or an unbacked disk. On macOS and
> Windows the volume lives inside the Docker VM's disk image — back it up as
> part of this machine.

## Backup (recommended: logical dump)

A logical `mysqldump` is consistent (`--single-transaction` for InnoDB),
portable, restorable to a fresh database, and does **not** require stopping the app:

> **Credentials.** The commands below assume the default `gameshelf`/`gameshelf`
> credentials from `.env.example`. If you changed `MYSQL_USER`/`MYSQL_PASSWORD`,
> substitute them in the `-u`/`-p` flags.

```bash
mkdir -p backups
docker compose exec -T mysql mysqldump -ugameshelf -pgameshelf \
  --single-transaction --routines --triggers --no-tablespaces \
  gameshelf > "backups/gameshelf-$(date +%Y%m%d-%H%M%S).sql"
```

The dump lands in `backups/` (gitignored). Store it somewhere durable — it _is_
your library.

## Restore (the critical procedure)

Load a dump into a **fresh, empty** `gameshelf` database — after data loss, a
rebuild, or a move to a new host:

```bash
# 1. Stop the app so it does not write while you restore (Ctrl-C `npm run dev`).

# 2. Ensure MySQL is up and healthy.
docker compose up -d mysql && docker compose ps    # wait for "healthy"

# 3. Drop and recreate an empty gameshelf database.
docker compose exec mysql mysql -ugameshelf -pgameshelf -e \
  "DROP DATABASE IF EXISTS gameshelf; CREATE DATABASE gameshelf CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"

# 4. Load the dump (recreates schema + data).
docker compose exec -T mysql mysql -ugameshelf -pgameshelf gameshelf \
  < "backups/gameshelf-<your-timestamp>.sql"

# 5. Verify the data came back.
docker compose exec mysql mysql -ugameshelf -pgameshelf gameshelf -e \
  "SELECT COUNT(*) AS users FROM users; SELECT COUNT(*) AS games FROM games;"

# 6. Start the app; confirm you can log in and see your library.
npm run dev
```

Expected: `users`/`games` counts match the source, you can log in, and the
library is intact. On a **brand-new host** the same steps work — `docker compose
up -d mysql` creates an empty `gameshelf` database, then run steps 3–6. The
committed migrations are not needed for a restore (the dump already contains the
schema); they are only needed for a from-scratch setup (see [Setup](installation.md#setup)).

## Alternative: physical data-directory snapshot

For a full point-in-time snapshot of the MySQL data dir, stop the service and
copy the named volume out (a live InnoDB copy is unsafe, so MySQL must be
stopped):

```bash
docker compose stop mysql
ts=$(date +%s)
mkdir -p data
docker run --rm -v gameshelf-mysql-data:/from:ro -v "$PWD/data":/to \
  alpine tar czf "/to/mysql.bak.$ts.tgz" -C /from .
docker compose start mysql
```

Restore — this replaces the volume's contents, so MySQL must be stopped:

```bash
docker compose stop mysql
docker run --rm -v gameshelf-mysql-data:/from -v "$PWD/data":/to \
  alpine sh -c 'rm -rf /from/* /from/.[!.]* ; tar xzf "/to/mysql.bak.<ts>.tgz" -C /from'
docker compose start mysql
```

Prefer the logical dump for game data.

# Operational checks

Run these after setup and after any incident. All are read-only and safe while
the app is up.

The URLs below use the default ports; substitute your `API_PORT` / `WEB_PORT`.

| Check                  | Command                                                                                      | Expected                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| API health             | `curl -fsS http://localhost:3001/health`                                                     | `{"status":"ok"}`                                                     |
| Queue health           | `curl -fsS http://localhost:3001/health/queue`                                               | job counts per status from MySQL + worker ready (HTTP 200)            |
| IGDB connectivity      | `curl -fsS http://localhost:3001/health/igdb`                                                | `{"status":"ok","token":"cached"}` (or `acquired`)                    |
| MySQL charset          | see "Confirming the character set"                                                           | `character_set_server=utf8mb4`, `collation_server=utf8mb4_0900_ai_ci` |
| Migration drift        | `npm run db:migrate:check`                                                                   | exit 0 (no drift)                                                     |
| Durable data dir       | **human check** — confirm the `gameshelf-mysql-data` volume is on durable, backed-up storage | you confirm it                                                        |
| Zero external requests | see [Single-Origin Frontend & API](../single-origin-frontend-api.md)                         | no non-GameShelf hosts                                                |

The **durable data dir** row is the ADR-001 check the application cannot perform
for you — it is always a human decision.
