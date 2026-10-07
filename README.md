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

| Command                    | Description                                                    |
| -------------------------- | -------------------------------------------------------------- |
| `npm run dev`              | Start API + web in watch mode                                  |
| `npm run dev:api`          | Start only the NestJS API                                      |
| `npm run dev:web`          | Start only the Next.js frontend                                |
| `npm run build`            | Build both workspaces                                          |
| `npm run db:migrate`       | Local migration (Prisma, shadow DB)                            |
| `npm run platforms:sync`   | Fetch and reconcile the canonical IGDB platform list locally   |
| `npm run db:deploy`        | Apply committed migrations                                     |
| `npm run db:migrate:check` | Fail if schema and deployed DB diverge                         |
| `npm run db:generate`      | Regenerate the Prisma client                                   |
| `npm run db:studio`        | Open Prisma Studio                                             |
| `npm run user:create`      | Create an account from the terminal (prompts for the password) |
| `npm run user:passwd`      | Reset an account's password from the terminal (prompts for it) |
| `npm run typecheck`        | Type-check both workspaces                                     |
| `npm run test`             | Run the API test suite (unit + e2e)                            |
| `npm run lint`             | Lint both workspaces                                           |
| `npm run lint:fix`         | Lint both workspaces and autofix                               |
| `npm run format`           | Format the whole repo with Prettier                            |
| `npm run format:check`     | Check formatting without writing                               |

### Code quality and git hooks

ESLint runs the typed `strictTypeChecked` and `stylisticTypeChecked` presets, while Prettier owns formatting (conflicting ESLint rules are disabled via `eslint-config-prettier`).

`npm install` runs `husky`, which points Git at `.husky/`. The `pre-commit` hook runs `lint-staged` (ESLint `--fix` + Prettier on staged files) and then a full `npm run typecheck`; commits that fail either check are rejected.

### Task shortcuts

A [`Taskfile.yml`](./Taskfile.yml) provides [Task](https://taskfile.dev/) shortcuts (install the `task` binary first):

| Command       | Description                                                         |
| ------------- | ------------------------------------------------------------------- |
| `task --list` | List all available tasks                                            |
| `task check`  | Run all quality gates: format check, lint, typecheck                |
| `task test`   | Run the API test suite (unit + e2e)                                 |
| `task ci`     | `task check` plus a production build, tests and the migration check |
| `task fix`    | Apply ESLint autofixes and Prettier formatting                      |

## Single origin, CSP, and fonts

The browser talks to **one origin only** — the Next.js web app. Every API call
goes to a same-origin `/api/:path*` URL, which Next.js rewrites server-side to
the NestJS API (`apps/web/next.config.mjs`). `NEXT_PUBLIC_API_URL` is the
internal server-side target of that rewrite and of SSR; the browser never calls
it directly. Because of this, the `gameshelf_session` cookie is a host-only
**first-party** cookie on the app's own origin — there is no CORS configuration,
no cookie `Domain`, and no external reverse proxy or TLS terminator assumed
anywhere in the stack.

The app ships a strict Content Security Policy (`apps/web/src/middleware.ts`):

- every directive (`default-src`, `script-src`, `style-src`, `img-src`,
  `font-src`, `connect-src`, …) is `'self'`-only; there is no external host, no
  `*`, and no `'unsafe-inline'`;
- a fresh per-request nonce (plus `'strict-dynamic'`) lets Next.js run its inline
  bootstrap/flight scripts without `'unsafe-inline'`;
- `'unsafe-eval'` is present in development only;
- there is deliberately no `upgrade-insecure-requests`, so the supported
  `http://localhost` install keeps working.

Fonts are **self-hosted at build time**: `next/font/google` downloads Geist
during `npm run build` and emits it under `/_next/static/media/*.woff2`, served
by the app. No font CDN is contacted at runtime, which is why `font-src 'self'`
is sufficient.

**Zero-external-request guarantee.** A page load makes no request to a
non-GameShelf origin. Verify it in DevTools → Network (hard-reload any page; every
request host is the app origin), or from the shell:

```bash
curl -sS http://localhost:3000/login | grep -oE '(src|href)="https?://[^"]+"' || echo 'OK: none'
grep -rIl 'fonts.gstatic\|fonts.googleapis' apps/web/.next/static || echo OK
```

See [`docs/features/single-origin-frontend-api.md`](./docs/features/single-origin-frontend-api.md)
for the full CSP directive table and verification steps.

## Accounts and registration

GameShelf has **no public self-registration**. There is deliberately no signup
route or signup link, and paths such as `POST /auth/register`, `POST /signup`
or `POST /users` return `404`. This is a security decision, not an unfinished
feature — do not "helpfully" add a public registration endpoint. The absence
is enforced by the regression test
`apps/api/test/e2e/no-registration.e2e-spec.ts` (part of `npm run test`).

Accounts are provisioned only by:

- **First-run setup** — `POST /setup` creates the very first account and is
  permanently disabled (`409 Setup has already been completed`) once a user
  exists. See [`docs/features/first-run-setup.md`](./docs/features/first-run-setup.md).
- **The CLI** — operator-run commands that reuse `UsersService`, for when the
  first account already exists (or the only account is locked out):
  - `npm run user:create -- --email <email>` — create an account. The command
    prompts for the password without echoing it; it is never accepted as a
    command-line argument.
  - `npm run user:passwd -- --email <email>` — set a new password (the
    account-recovery path: there is no email/SMTP reset flow).

  Both accept the password on stdin when run non-interactively, so they work in
  scripts and CI:

  ```bash
  printf '%s\n' "$NEW_PASSWORD" | npm run user:passwd -- --email player@example.com
  ```

  Failures — missing `--email`, blank email, empty password, password mismatch,
  duplicate email on create, unknown email on passwd — print a readable message
  to stderr and exit non-zero. Validation and hashing use the same code path as
  first-run setup (`UsersService.prepareUser`); the CLI adds no separate rules.
  See [`docs/features/user-cli.md`](./docs/features/user-cli.md).

Additional users therefore require operator action. The web client exposes no
signup page or link either; that is enforced by the frontend ticket.

## Testing

The API has a two-tier Jest suite (`apps/api/jest.config.js`), run from the repository root:

| Command             | What it runs                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run test`      | Both tiers (unit, then e2e)                                                                          |
| `npm run test:unit` | Unit tests only — services with a mocked `PrismaService`, **no database needed**                     |
| `npm run test:e2e`  | E2E tests only — a real Nest app (supertest) against a real MySQL **test** database and a real Redis |

(`test:unit` / `test:e2e` are `apps/api` workspace scripts; from the root use `npm run test:unit --workspace apps/api` etc., or `task test` for the full suite.)

The e2e tier boots the full `AppModule`, which creates the BullMQ photo-import worker on start (ADR-002) — so e2e requires a reachable Redis in addition to MySQL (`docker compose up -d mysql redis`). The queue spec (`photo-import-queue.e2e-spec.ts`) obliterates the queue between cases. The suite runs under its own Redis key prefix (`REDIS_QUEUE_PREFIX=bull-e2e`, set in `test/setup-env.ts`), so it shares the Redis server without sharing the queue keyspace: it can run while `npm run dev` is up, and neither side sees or wipes the other's jobs.

The Jest scripts set `NODE_OPTIONS=--experimental-vm-modules` because `@nestjs/schedule` is ESM-only while ts-jest runs in CommonJS mode. This is test-only and does not affect runtime.

**Test database.** The e2e tier uses a dedicated `gameshelf_test` database (never the dev `gameshelf` one), selected by `DATABASE_TEST_URL` in `.env` (default: `mysql://gameshelf:gameshelf@localhost:3306/gameshelf_test?charset=utf8mb4`).

- **Fresh data dir:** `docker compose up -d mysql` creates it automatically — `docker/mysql-init/02-test-database.sql` runs on first initialization of an empty data directory.
- **Existing data dir:** the init scripts only run once, so create it manually one time:

  ```bash
  docker compose exec -T mysql mysql -uroot -p"$(grep '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2)" < docker/mysql-init/02-test-database.sql
  ```

The e2e tier is **re-runnable**: before the suite it applies the committed migrations (`prisma migrate deploy`) and wipes all tables; every test starts from a reset database.

## CI (GitHub Actions)

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on **every push and every pull request** (all branches) on an `ubuntu-latest` runner. The single job is named `ci` and gates the run with:

| Step                  | Command                    | What it does                                                        |
| --------------------- | -------------------------- | ------------------------------------------------------------------- |
| Install               | `npm ci`                   | Deterministic install with lockfile-based caching                   |
| Prisma generate       | `npm run db:generate`      | Generate the client before any TypeScript check or build            |
| Lint                  | `npm run lint`             | ESLint (typed, strict) on both workspaces                           |
| Typecheck             | `npm run typecheck`        | `tsc --noEmit` on both workspaces                                   |
| Build                 | `npm run build`            | Production build of both workspaces                                 |
| Test                  | `npm run test`             | API unit + e2e tests (e2e against the `gameshelf_test` database)    |
| Apply migrations      | `npm run db:deploy`        | `prisma migrate deploy` against a throwaway MySQL service container |
| Migration drift check | `npm run db:migrate:check` | Fail if `schema.prisma` and the deployed database have diverged     |

**Pinned versions.** Node is pinned to **24.21.0** (kept in sync with `.nvmrc` and `engines.node` in `package.json`); the MySQL service container is pinned to **8.4** per ADR-001, with throwaway credentials that are discarded with the run. A **redis:7.4** service (ADR-002, AOF + `noeviction`) backs the BullMQ queue for the e2e tier.

**Failure semantics.** Any lint error or type error fails the run — type errors are never warnings-only (`tsc --noEmit` plus error-level typed ESLint rules). A schema change without a committed migration fails the drift check, because the deployed state no longer matches `schema.prisma`.

### Running the same checks locally

```bash
docker compose up -d mysql   # needed for the tests and the migration check
task ci                       # generate, format check, lint, typecheck, build, test, migration check
```

On machines without [`task`](https://taskfile.dev/), the raw-npm equivalent:

```bash
npm run db:generate
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test
npm run db:deploy
npm run db:migrate:check
```

If the local drift check fails because the dev database is stale, run `npm run db:migrate` first — the check compares the _live_ dev database against `schema.prisma`.

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

The **shadow database** (`gameshelf_shadow`) is created by `docker/mysql-init/01-prisma-shadow.sql` on **first initialization only**, and is required by `prisma migrate dev` (local work). The **test database** (`gameshelf_test`, used by the e2e tier — see "Testing") is created the same way by `docker/mysql-init/02-test-database.sql`. To change either you must reset the data directory: `docker compose down && rm -rf data/mysql`.

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

The BullMQ queue connects using **only** `REDIS_HOST` and `REDIS_PORT` from `.env` (defaults: `localhost` / `6379`), per ADR-002. `REDIS_URL` is present in `.env.example` for convenience but is **not read by the application** — setting it has no effect on the queue connection. An invalid `REDIS_PORT` (not a plain decimal, or outside 1–65535) fails startup.

`REDIS_QUEUE_PREFIX` (default `bull`, BullMQ's own default) namespaces the queue's Redis keys (`"<prefix>:<queue>:..."`). It is a keyspace namespace, not a connection setting — host and port remain the only connection inputs. Tests use a separate prefix so they cannot touch a running dev queue.

### Worker restart and shutdown

Queued jobs live in Redis, so they survive an API restart: stop the API, enqueue (jobs stay `waiting`), start it again, and the worker drains them.

Each photo job inherits `attempts: 3` and exponential backoff (`IMPORT_RETRY_BACKOFF_MS`) from the registered queue's `defaultJobOptions`, so upload and retry enqueue paths cannot drift. A transient failure (e.g. an external 429) throws a retryable error, the `import_jobs` row stays `processing`, and the retry re-runs only the titles that are still unresolved — the vision provider is called at most once per photo (a `vision_completed_at` marker plus a transaction make the recognition write one-shot). A job is marked `failed` only on a non-retryable error or on the final attempt. Confirmed games are saved in one MySQL transaction per batch (batch size 10), so a worker killed mid-job leaves the earlier batches committed.

**Worker settings** (ticket 3.7; all compile-time constants, not env vars):

| Setting                | Value                                  | Constant                         |
| ---------------------- | -------------------------------------- | -------------------------------- |
| Concurrency            | 1 (ADR-002)                            | `PHOTO_IMPORT_CONCURRENCY`       |
| Attempts               | 3 total (initial + 2 retries)          | `IMPORT_MAX_ATTEMPTS`            |
| Backoff                | exponential, base 5 s (5 s, then 10 s) | `IMPORT_RETRY_BACKOFF_MS`        |
| Per-job timeout        | 300 s (5 min)                          | `IMPORT_JOB_TIMEOUT_MS`          |
| Lock duration          | 360 s (6 min, > timeout)               | `IMPORT_JOB_LOCK_DURATION_MS`    |
| Lock renew time        | 180 s (half the lock)                  | `IMPORT_JOB_LOCK_RENEW_TIME_MS`  |
| Stalled-check interval | 30 s                                   | `IMPORT_JOB_STALLED_INTERVAL_MS` |
| Max stalled recoveries | 2                                      | `IMPORT_JOB_MAX_STALLED_COUNT`   |

Job defaults are applied once through `registerQueue`'s `defaultJobOptions` (`photoImportDefaultJobOptions()`); worker options (`photoImportWorkerOptions()`) are applied to the `@Processor`. A job that exceeds the per-job timeout fails with a retryable error and is retried per the backoff above, and is marked `failed` on the last attempt. The timeout **aborts** the attempt (`AbortController`): the in-flight pipeline stops at the next batch boundary and commits no further batch, and `commitImportBatch` refuses to write once the job is terminal — so an abandoned attempt cannot collide with the retry or mutate the DB after `markFailed`. `markCompleted`/`markFailed` write conditionally (`WHERE status IN ('queued','processing')`), so a late writer can never clobber a newer terminal status. **Timeout headroom:** the 300 s budget is sized for a shelf of up to ~50 titles (one vision call at `VISION_REQUEST_TIMEOUT_MS = 30 s`, plus ~50 sequential IGDB lookups through the central rate limiter — 4 req/s, 8 concurrent, so a single sequential path is paced at ~250 ms per request — at up to `IGDB_REQUEST_TIMEOUT_MS = 5 s` each ≈ 30 s + 50 × 5.25 s ≈ 295 s); IGDB 429s are retried internally up to `IGDB_MAX_ATTEMPTS = 3` with exponential backoff (base 500 ms, cap 5 s), while timeouts/5xx/network failures remain BullMQ's responsibility. A photo recognized with substantially more titles can hit the timeout and be retried. The BullMQ lock deliberately outlives the whole permitted job (`lockDuration > jobTimeout`), so a live worker cannot lose its lock mid-job and a second worker can never process the same job concurrently. If a worker is killed mid-job, its lock stops being renewed and expires after at most `lockDuration`; the next stalled check (`stalledInterval`) moves the job back to `waiting` and re-runs it — recovery within roughly `lockDuration + stalledInterval`. Because the pipeline is idempotent, the re-run never duplicates a saved game or a second vision call. Every attempt emits exactly one structured JSON outcome line (`event: "photo_import_job"`) with the job id, photo, counts, duration, attempt, and outcome.

The uploaded photo is kept while its job is `queued`/`processing` or `failed`-retryable, deleted by the pipeline once the job completes, and cleaned up by an hourly backstop sweep otherwise. The sweep removes a leftover file from a failed pipeline delete, `dismissed` job photos, a `failed` job's photo after a 7-day retry window, an abandoned `queued`/`processing` job's photo after 48 h, and files with no owning job; a `failed` job is retryable only while its photo exists. See `docs/features/photo-lifecycle.md`.

Shutdown is deterministic even when Redis is unreachable. `PhotoImportProcessor.beforeApplicationShutdown` force-closes the BullMQ worker (`worker.close(true)`) before Nest runs `@nestjs/bullmq`'s own shutdown, which otherwise waits on the reconnecting blocking connection forever. This is what lets `SIGTERM` terminate the process promptly during a Redis outage instead of hanging until `SIGKILL`.

Manual verification performed (compiled app, Redis **down** on `REDIS_PORT=6399`):

```bash
REDIS_PORT=6399 API_PORT=3999 node apps/api/dist/main.js &
kill -TERM $!        # process exits in well under a second
```

Measured on the compiled app: **~0.1 s** to exit after the fix, versus **still running after 25 s** (then `SIGKILL`ed) on the pre-fix build.

## Environment variables

All variables live in a single root `.env` file (see `.env.example`):

| Variable              | Used by    | Purpose                                                                                                                                                                            |
| --------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`            | both       | Runtime environment                                                                                                                                                                |
| `API_PORT`            | `apps/api` | API listen port (default `3001`)                                                                                                                                                   |
| `API_HOST`            | `apps/api` | API bind address                                                                                                                                                                   |
| `WEB_PORT`            | `apps/web` | Web dev server port (default `3000`)                                                                                                                                               |
| `NEXT_PUBLIC_API_URL` | `apps/web` | Internal API origin for the `/api` rewrite and SSR (never called by the browser)                                                                                                   |
| `MYSQL_HOST`          | `apps/api` | MySQL host (default `localhost`)                                                                                                                                                   |
| `MYSQL_PORT`          | `apps/api` | MySQL port (default `3306`)                                                                                                                                                        |
| `MYSQL_DATABASE`      | `apps/api` | Database name (default `gameshelf`)                                                                                                                                                |
| `MYSQL_USER`          | `apps/api` | App database user (default `gameshelf`)                                                                                                                                            |
| `MYSQL_PASSWORD`      | `apps/api` | App database user password                                                                                                                                                         |
| `MYSQL_ROOT_PASSWORD` | compose    | MySQL root password (compose only)                                                                                                                                                 |
| `DATABASE_URL`        | `apps/api` | Prisma connection string (utf8mb4)                                                                                                                                                 |
| `DATABASE_SHADOW_URL` | `apps/api` | Prisma shadow DB (migrate dev only)                                                                                                                                                |
| `REDIS_HOST`          | `apps/api` | Redis host (default `localhost`)                                                                                                                                                   |
| `REDIS_PORT`          | `apps/api` | Redis port (default `6379`)                                                                                                                                                        |
| `REDIS_QUEUE_PREFIX`  | `apps/api` | BullMQ key namespace (default `bull`)                                                                                                                                              |
| `REDIS_URL`           | `apps/api` | Redis connection string (present for convenience; **not read** by the app — the queue uses `REDIS_HOST`/`REDIS_PORT`)                                                              |
| `SESSION_SECRET`      | `apps/api` | HMAC-SHA256 key for session tokens (≥32 chars)                                                                                                                                     |
| `SESSION_TTL_MINUTES` | `apps/api` | Sliding session lifetime in minutes (default `10080`; no "never")                                                                                                                  |
| `GEMINI_API_KEY`      | `apps/api` | Gemini API key (fallback when no encrypted DB key is stored)                                                                                                                       |
| `OPENAI_API_KEY`      | `apps/api` | OpenAI API key (fallback when no encrypted DB key is stored)                                                                                                                       |
| `LLM_PROVIDER`        | `apps/api` | Active provider when no DB row exists: `gemini`/`openai` (default `gemini`)                                                                                                        |
| `LLM_MODEL`           | `apps/api` | Model override for the active provider (blank = provider default)                                                                                                                  |
| `LLM_SETTINGS_SECRET` | `apps/api` | Key-derivation secret for the stored API key's AES-256-GCM key (falls back to `SESSION_SECRET`)                                                                                    |
| `ANTHROPIC_API_KEY`   | `apps/api` | Reserved for a future provider; **not read** by the current code                                                                                                                   |
| `IMPORT_PHOTOS_DIR`   | `apps/api` | Ephemeral upload directory (default `<OS temp>/gameshelf-import-photos`); the pipeline deletes a photo after its job completes and a sweep removes leftovers (see Photo Lifecycle) |
| `IGDB_CLIENT_ID`      | `apps/api` | IGDB credentials                                                                                                                                                                   |
| `IGDB_CLIENT_SECRET`  | `apps/api` | IGDB credentials                                                                                                                                                                   |
| `IGDB_TOKEN_URL`      | `apps/api` | Optional OAuth token endpoint override (default `https://id.twitch.tv/oauth2/token`)                                                                                               |

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
├── docker/             # One-time MySQL init scripts (shadow DB + test DB)
├── docker-compose.yml    # Local dev MySQL + Redis (convenience only)
├── data/                 # Persistent dev data (gitignored)
├── .nvmrc              # Pinned Node version
└── package.json        # Workspaces + root scripts
```
