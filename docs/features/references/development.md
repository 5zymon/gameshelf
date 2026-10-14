---
type: Guide
title: Development Guide
description: Workspaces, root npm scripts, Task shortcuts, git hooks, the two-tier API test suite, CI gates, and the repository layout.
tags: [development, testing, ci, tooling]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-14T11:52:50.449Z }
---

# Overview

Everything needed to change GameShelf and get a pull request through CI.

# Workspaces

GameShelf is an npm-workspaces monorepo with three packages:

| Package                | Path                 | Description                                           |
| ---------------------- | -------------------- | ----------------------------------------------------- |
| `@gameshelf/api`       | `apps/api`           | HTTP API built with [NestJS](https://nestjs.com/)     |
| `@gameshelf/web`       | `apps/web`           | Frontend built with [Next.js](https://nextjs.org/)    |
| `@gameshelf/contracts` | `packages/contracts` | Shared TypeScript wire types (`@gameshelf/contracts`) |

# Scripts

All root scripts (run from the repository root):

| Command                     | Description                                                                    |
| --------------------------- | ------------------------------------------------------------------------------ |
| `npm run setup`             | One-command local setup (install, `.env`, MySQL, migrate, generate)            |
| `npm run dev`               | Start API + web in watch mode                                                  |
| `npm run dev:api`           | Start only the NestJS API                                                      |
| `npm run dev:web`           | Start only the Next.js frontend                                                |
| `npm run build`             | Build both workspaces                                                          |
| `npm run db:migrate`        | Local migration (Prisma, shadow DB)                                            |
| `npm run platforms:sync`    | Fetch and reconcile the canonical IGDB platform list locally                   |
| `npm run covers:redownload` | Re-download every missing game cover from its stored link                      |
| `npm run db:clear-dev`      | Dev only: delete all games, import data and platforms, keep accounts           |
| `npm run db:seed`           | Dev only: create the QA account and sample platforms/games (idempotent)        |
| `npm run db:deploy`         | Apply committed migrations                                                     |
| `npm run db:migrate:check`  | Fail if schema and deployed DB diverge                                         |
| `npm run db:generate`       | Regenerate the Prisma client                                                   |
| `npm run db:studio`         | Open Prisma Studio                                                             |
| `npm run user:create`       | Create an account from the terminal (prompts for email and password)           |
| `npm run user:passwd`       | Reset an account's password from the terminal (prompts for email and password) |
| `npm run typecheck`         | Type-check both workspaces                                                     |
| `npm run test`              | Run the API test suite (unit + e2e)                                            |
| `npm run lint`              | Lint both workspaces                                                           |
| `npm run lint:fix`          | Lint both workspaces and autofix                                               |
| `npm run format`            | Format the whole repo with Prettier                                            |
| `npm run format:check`      | Check formatting without writing                                               |
| `npm run clean`             | Remove `node_modules` and build output                                         |

# Code quality and git hooks

ESLint runs the typed `strictTypeChecked` and `stylisticTypeChecked` presets, while Prettier owns formatting (conflicting ESLint rules are disabled via `eslint-config-prettier`).

`npm install` runs `husky`, which points Git at `.husky/`. The `pre-commit` hook runs `lint-staged` (ESLint `--fix` + Prettier on staged files) and then a full `npm run typecheck`; commits that fail either check are rejected.

# Task shortcuts

A [`Taskfile.yml`](../../../Taskfile.yml) provides [Task](https://taskfile.dev/) shortcuts (install the `task` binary first):

| Command       | Description                                                         |
| ------------- | ------------------------------------------------------------------- |
| `task --list` | List all available tasks                                            |
| `task check`  | Run all quality gates: format check, lint, typecheck                |
| `task test`   | Run the API test suite (unit + e2e)                                 |
| `task ci`     | `task check` plus a production build, tests and the migration check |
| `task fix`    | Apply ESLint autofixes and Prettier formatting                      |

# Testing

The API has a two-tier Jest suite (`apps/api/jest.config.js`), run from the repository root:

| Command             | What it runs                                                                        |
| ------------------- | ----------------------------------------------------------------------------------- |
| `npm run test`      | Both tiers (unit, then e2e)                                                         |
| `npm run test:unit` | Unit tests only — services with a mocked `PrismaService`, **no database needed**    |
| `npm run test:e2e`  | E2E tests only — a real Nest app (supertest) against a real MySQL **test** database |

(`test:unit` / `test:e2e` are `apps/api` workspace scripts; from the root use `npm run test:unit --workspace apps/api` etc., or `task test` for the full suite.)

The e2e tier boots the full `AppModule`, which starts the in-process MySQL-backed photo-import worker on start (ADR-005) — so e2e needs only MySQL (`docker compose up -d mysql`). The queue specs shrink the worker's timings through the `PHOTO_IMPORT_QUEUE_OPTIONS` override (or pass `autoStart: false` when a spec only observes enqueueing), and `resetDatabase` clears the queue rows, so the suite can run while `npm run dev` is up.

The Jest scripts set `NODE_OPTIONS=--experimental-vm-modules` because `@nestjs/schedule` is ESM-only while ts-jest runs in CommonJS mode. This is test-only and does not affect runtime.

**Test database.** The e2e tier uses a dedicated `gameshelf_test` database (never the dev `gameshelf` one), selected by `DATABASE_TEST_URL` in `.env` (`.env.example` sets `mysql://gameshelf:gameshelf@localhost:3306/gameshelf_test?charset=utf8mb4`; when it is unset the tests use the same database on `127.0.0.1`).

- **Fresh data dir:** `docker compose up -d mysql` creates it automatically — `docker/mysql-init/02-test-database.sql` runs on first initialization of an empty data directory.
- **Existing data dir:** the init scripts only run once, so create it manually one time:

  ```bash
  docker compose exec -T mysql mysql -uroot -p"$(grep '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2)" < docker/mysql-init/02-test-database.sql
  ```

The e2e tier is **re-runnable**: before the suite it applies the committed migrations (`prisma migrate deploy`) and wipes all tables; every test starts from a reset database.

# CI (GitHub Actions)

[`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) runs on **pull requests** (any base branch) on an `ubuntu-latest` runner — a plain branch push starts no run, and CI is (re)triggered by the PR including `synchronize` on each new commit. The single job is named `ci` and gates the run with:

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

**Pinned versions.** Node is pinned to **24.21.0** (kept in sync with `.nvmrc` and `engines.node` in `package.json`); the MySQL service container is pinned to **8.4** per ADR-001, with throwaway credentials that are discarded with the run.

**Failure semantics.** Any lint error or type error fails the run — type errors are never warnings-only (`tsc --noEmit` plus error-level typed ESLint rules). A schema change without a committed migration fails the drift check, because the deployed state no longer matches `schema.prisma`.

## Running the same checks locally

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

# Repository layout

```
.
├── apps/
│   ├── api/            # NestJS API
│   │   └── prisma/     # Prisma schema + committed migrations
│   └── web/            # Next.js frontend
├── packages/contracts/ # Shared wire types (@gameshelf/contracts)
├── scripts/            # setup.sh (npm run setup)
├── .github/            # CI workflow and README media
├── docs/               # OKF feature documentation bundle
├── tsconfig.base.json  # Shared strict TypeScript config
├── .husky/             # Git hooks (pre-commit)
├── .env.example        # Environment variable template
├── docker/             # One-time MySQL init scripts (shadow DB + test DB)
├── docker-compose.yml  # Local dev MySQL (convenience only)
├── data/               # Physical MySQL volume snapshots (gitignored)
├── backups/            # Logical MySQL dumps (gitignored)
├── covers/             # Cached covers and thumbnails, COVERS_DIR (gitignored)
├── .nvmrc              # Pinned Node version
└── package.json        # Workspaces + root scripts
```
