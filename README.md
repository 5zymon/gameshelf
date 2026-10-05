# GameShelf

Track, organize, and discover your video game library.

GameShelf is an npm-workspaces monorepo with two packages:

| Package          | Path       | Description                                        |
| ---------------- | ---------- | -------------------------------------------------- |
| `@gameshelf/api` | `apps/api` | HTTP API built with [NestJS](https://nestjs.com/)  |
| `@gameshelf/web` | `apps/web` | Frontend built with [Next.js](https://nextjs.org/) |

## Prerequisites

- **Node.js 24 LTS** (`>=24 <25`) — pinned in `.nvmrc` and `package.json` (`engines.node`).
- **npm 11+** (ships with Node 24).
- [nvm](https://github.com/nvm-sh/nvm) (optional but recommended) to select the pinned Node version.
- **Docker** (optional) — only for the convenience `docker-compose.yml` that starts the dev MySQL and Redis. The app itself needs just a MySQL 8.4 server reachable at `MYSQL_HOST:MYSQL_PORT` and a Redis 7.4 server reachable at `REDIS_HOST:REDIS_PORT`; system-installed servers work identically.

The root scripts call `concurrently` and the workspace CLIs, so everything runs from the repository root.

## Setup

```bash
# 1. Install the pinned Node version
nvm install    # reads .nvmrc
nvm use

# 2. Install dependencies for both workspaces (run at the repo root)
npm install

# 3. Create your local environment file
cp .env.example .env
# then edit .env and fill in real values

# 4. Start the local dev database (optional — see "Database (local dev)")
docker compose up -d mysql
```

`.env` is gitignored; `.env.example` lists every variable the app reads with placeholder values only.

## Running

Start the API and the web app together with a single command:

```bash
npm run dev
```

`npm run dev` runs `concurrently` and starts:

- **API** — NestJS on <http://localhost:3001> (health check at `/health`)
- **Web** — Next.js on <http://localhost:3000>

Other useful scripts (all run from the root):

| Command                | Description                         |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | Start API + web in watch mode       |
| `npm run dev:api`      | Start only the NestJS API           |
| `npm run dev:web`      | Start only the Next.js frontend     |
| `npm run build`        | Build both workspaces               |
| `npm run db:migrate`   | Local migration (Prisma, shadow DB) |
| `npm run db:deploy`    | Apply committed migrations          |
| `npm run db:generate`  | Regenerate the Prisma client        |
| `npm run db:studio`    | Open Prisma Studio                  |
| `npm run typecheck`    | Type-check both workspaces          |
| `npm run lint`         | Lint both workspaces                |
| `npm run lint:fix`     | Lint both workspaces and autofix    |
| `npm run format`       | Format the whole repo with Prettier |
| `npm run format:check` | Check formatting without writing    |

### Code quality and git hooks

ESLint runs the typed `strictTypeChecked` and `stylisticTypeChecked` presets, while Prettier owns formatting (conflicting ESLint rules are disabled via `eslint-config-prettier`).

`npm install` runs `husky`, which points Git at `.husky/`. The `pre-commit` hook runs `lint-staged` (ESLint `--fix` + Prettier on staged files) and then a full `npm run typecheck`; commits that fail either check are rejected.

### Task shortcuts

A [`Taskfile.yml`](./Taskfile.yml) provides [Task](https://taskfile.dev/) shortcuts (install the `task` binary first):

| Command       | Description                                          |
| ------------- | ---------------------------------------------------- |
| `task --list` | List all available tasks                             |
| `task check`  | Run all quality gates: format check, lint, typecheck |
| `task ci`     | `task check` plus a production build                 |
| `task fix`    | Apply ESLint autofixes and Prettier formatting       |

There is no unit-test runner in the repo yet; once one is added, its script should be wired into `task check`/`task ci`.

## Database (local dev)

GameShelf uses **MySQL 8.4** with `utf8mb4` / `utf8mb4_0900_ai_ci` (ADR-001 — game titles contain CJK and accented characters; `latin1`/`utf8mb3` would corrupt them).

### Starting the database

Docker Compose is a **convenience, not a dependency**: the app only needs a MySQL server reachable at `MYSQL_HOST:MYSQL_PORT`. A system-installed MySQL 8.4 configured with the same charset works identically.

```bash
docker compose up -d mysql     # starts the pinned mysql:8.4
docker compose ps              # wait until the service is "healthy"
```

### Confirming the character set

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

### Persistent data directory

The data directory is bind-mounted to `./data/mysql` (gitignored) — a real host path, **not** an ephemeral container path. Recreating the container never loses data. The application cannot verify that this path sits on durable storage — that is a human check.

To reset the dev database completely:

```bash
docker compose down && rm -rf data/mysql
```

Note: the MySQL image creates the database and user only on **first** initialization (empty data directory). Changing `MYSQL_USER`/`MYSQL_PASSWORD` in `.env` later has no effect until you reset.

### Migrations (Prisma)

Prisma is the data-access layer (ADR-003). The schema lives at `apps/api/prisma/schema.prisma`, and every schema change is captured as a committed migration under `apps/api/prisma/migrations/`. Because the migrations are in git, the schema is fully rebuildable from a clean clone — the container filesystem is disposable (ADR-001).

| Command              | Prisma command          | When to use                             |
| -------------------- | ----------------------- | --------------------------------------- |
| `npm run db:migrate` | `prisma migrate dev`    | Local development (uses the shadow DB)  |
| `npm run db:deploy`  | `prisma migrate deploy` | Durable environments (apply migrations) |

**`prisma db push` is forbidden outside throwaway experiments.** It syncs the schema directly and bypasses the migration history, so it must never be used in a durable environment.

The generated Prisma client is a **build artifact**: it is written to `apps/api/src/generated/` (gitignored) and regenerated automatically by `npm run build` — never commit it.

The **shadow database** (`gameshelf_shadow`) is created by `docker/mysql-init/01-prisma-shadow.sql` on **first initialization only**, and is required by `prisma migrate dev` (local work). To change it you must reset the data directory: `docker compose down && rm -rf data/mysql`.

**Character set:** the `?charset=utf8mb4` suffix in `DATABASE_URL` is declarative — Prisma's MySQL connector does not parse it. The real enforcement is threefold: the migration engine connects with `utf8mb4` (MySQL ≥ 5.5.3), every generated table declares `DEFAULT CHARACTER SET utf8mb4`, and the server runs with `--character-set-server=utf8mb4` (see "Confirming the character set").

## Redis (local dev)

GameShelf uses **Redis 7.4** as the BullMQ job queue backing store (ADR-002).

### Starting the queue

Docker Compose is a **convenience, not a dependency**: the app only needs a Redis server reachable at `REDIS_HOST:REDIS_PORT`. A system-installed Redis 7.4 with AOF enabled works identically.

```bash
docker compose up -d redis     # starts the pinned redis:7.4
docker compose ps              # wait until the service is "healthy"
```

(`docker compose up -d` starts both services at once.)

### Confirming AOF persistence

AOF is enabled via the `--appendonly yes` command flag in `docker-compose.yml`. Verify it:

```bash
docker compose exec redis redis-cli CONFIG GET appendonly
```

Expected:

```
appendonly
yes
```

### Confirming data persistence

Write a key, restart Redis, and read it back:

```bash
docker compose exec redis redis-cli SET persistence-test "survives-restart"
docker compose restart redis
docker compose exec redis redis-cli GET persistence-test
```

Expected: `survives-restart`

### Persistent data directory

The data directory is bind-mounted to `./data/redis` (gitignored) — a real host path, **not** an ephemeral container path. Recreating the container never loses data. The application cannot verify that this path sits on durable storage — that is a human check.

To reset the dev Redis completely:

```bash
docker compose down && rm -rf data/redis
```

### Connection settings

`REDIS_HOST` and `REDIS_PORT` from `.env` (defaults: `localhost` / `6379`). `REDIS_URL` is also available in `.env.example` for convenience.

## Environment variables

All variables live in a single root `.env` file (see `.env.example`):

| Variable              | Used by    | Purpose                                 |
| --------------------- | ---------- | --------------------------------------- |
| `NODE_ENV`            | both       | Runtime environment                     |
| `API_PORT`            | `apps/api` | API listen port (default `3001`)        |
| `API_HOST`            | `apps/api` | API bind address                        |
| `WEB_PORT`            | `apps/web` | Web dev server port (default `3000`)    |
| `NEXT_PUBLIC_API_URL` | `apps/web` | Browser-facing API base URL             |
| `MYSQL_HOST`          | `apps/api` | MySQL host (default `localhost`)        |
| `MYSQL_PORT`          | `apps/api` | MySQL port (default `3306`)             |
| `MYSQL_DATABASE`      | `apps/api` | Database name (default `gameshelf`)     |
| `MYSQL_USER`          | `apps/api` | App database user (default `gameshelf`) |
| `MYSQL_PASSWORD`      | `apps/api` | App database user password              |
| `MYSQL_ROOT_PASSWORD` | compose    | MySQL root password (compose only)      |
| `DATABASE_URL`        | `apps/api` | Prisma connection string (utf8mb4)      |
| `DATABASE_SHADOW_URL` | `apps/api` | Prisma shadow DB (migrate dev only)     |
| `REDIS_HOST`          | `apps/api` | Redis host (default `localhost`)        |
| `REDIS_PORT`          | `apps/api` | Redis port (default `6379`)             |
| `REDIS_URL`           | `apps/api` | Redis connection string                 |
| `SESSION_SECRET`      | `apps/api` | Secret used to sign session cookies     |
| `OPENAI_API_KEY`      | `apps/api` | LLM provider key                        |
| `ANTHROPIC_API_KEY`   | `apps/api` | LLM provider key                        |
| `IGDB_CLIENT_ID`      | `apps/api` | IGDB credentials                        |
| `IGDB_CLIENT_SECRET`  | `apps/api` | IGDB credentials                        |

## Repository layout

```
.
├── apps/
│   ├── api/            # NestJS API
│   │   └── prisma/     # Prisma schema + committed migrations
│   └── web/            # Next.js frontend
├── docs/               # OKF feature documentation bundle
├── tsconfig.base.json  # Shared strict TypeScript config
├── .husky/             # Git hooks (pre-commit)
├── .env.example        # Environment variable template
├── docker/             # One-time MySQL init scripts (Prisma shadow DB)
├── docker-compose.yml    # Local dev MySQL + Redis (convenience only)
├── data/                 # Persistent dev data (gitignored)
├── .nvmrc              # Pinned Node version
└── package.json        # Workspaces + root scripts
```
