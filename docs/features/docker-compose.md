---
type: Feature
title: Docker Compose Quick Start
description: One-command `docker compose up --build` that builds and runs the whole app (MySQL, migrations, API, web) from a fresh clone with no Node.js or `.env`, while the `mysql` service alone remains the dev database for the Node-based flow.
tags: [operations, docker, setup]
status: draft
generated: { by: opencode/home-model, at: 2026-10-12T19:35:09Z }
sources:
  - docker-compose.yml
  - apps/api/Dockerfile
  - apps/web/Dockerfile
  - .dockerignore
---

# Overview

A fresh public clone starts with one command and needs only Docker:

```bash
docker compose up --build
```

Open <http://localhost:3000>. A new install redirects to `/setup`, where
[First-run Setup](/first-run-setup.md) creates the first account (there is no
public signup). The same `docker-compose.yml` still serves the Node-based dev
flow: `npm run setup` runs `docker compose up -d mysql`, which starts only the
database.

This is a local/LAN convenience, not a production deployment (README, "Scope").
The app itself still depends only on a MySQL 8.4 server.

# Services

| Service   | Image                 | Role                                                                       | Host port                            |
| --------- | --------------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| `mysql`   | `mysql:8.4`           | Database, utf8mb4 / `utf8mb4_0900_ai_ci` (ADR-001), data in `./data/mysql` | `127.0.0.1:${MYSQL_PORT:-3306}`      |
| `migrate` | `gameshelf-api:local` | One-shot `npm run db:deploy` (`prisma migrate deploy`), then exits 0       | —                                    |
| `api`     | `gameshelf-api:local` | NestJS API, `node dist/main`; covers on the `covers` volume                | `127.0.0.1:${API_PORT:-3001}`        |
| `web`     | `gameshelf-web:local` | `next start` on 3000; rewrites `/api/*` to `http://api:3001`               | `${WEB_PORT:-3000}` (all interfaces) |

Start order is enforced with `depends_on` conditions:
`mysql` healthy → `migrate` completed successfully → `api` healthy → `web`.
Re-running `migrate` against an up-to-date database is a no-op.

Health checks use Node's global `fetch` (the `node` image has no `curl`):
`api` polls `GET /health`; `web` requests `/login` without following redirects
and is healthy on any status below 500.

# Images

Both Dockerfiles use the repository root as the build context (npm workspaces
need the root `package.json` and `package-lock.json`) and are pinned to
`node:24.21.0`, the CI Node version.

1. **deps**: copies only the workspace manifests and runs `npm ci` with
   `HUSKY=0` (no `.git` in the context). Shared by both images.
2. **build**: copies the source and runs the workspace build. The API runs
   `prisma generate && nest build`. The web app runs `next build` with
   `NEXT_PUBLIC_API_URL=http://api:3001`, because Next.js inlines
   `NEXT_PUBLIC_*` at build time (the browser never uses it; it only calls the
   same-origin `/api`). The web build downloads the Sora/Manrope fonts, so it
   needs network access.
3. **runtime**: a clean `node:24.21.0` with the whole built `/app` copied in.
   `node_modules` is deliberately not pruned: `migrate` runs the Prisma CLI (a
   devDependency) from the API image, and the operator CLIs run through
   `ts-node`.

The API image gates boot on database readiness. Before starting
`node dist/main`, its CMD runs a small `wait-for-db` script that retries a real
authenticated `SELECT 1` against `DATABASE_URL` until it succeeds. This makes
`docker compose restart` safe: unlike `up`, `restart` does not honour
`depends_on`, so the API can otherwise start before MySQL is ready — and a
boot-time DB failure leaves its Prisma connection pool stuck, returning 500s
until the container is restarted again. The gate removes that window.

`.dockerignore` keeps `.env`, `data/`, `.git`, `node_modules` and build output
out of the context, so no secret or local state ends up in an image.

# Configuration

Compose works with no `.env`. If a root `.env` exists, Compose reads it **only
for `${VAR}` substitution**; the containers never load it. The containers build
their own `DATABASE_URL`:

```text
mysql://${MYSQL_USER:-gameshelf}:${MYSQL_PASSWORD:-gameshelf}@mysql:3306/${MYSQL_DATABASE:-gameshelf}?charset=utf8mb4
```

| Variable                                                                                    | Default in compose                                | Notes                                                                                                         |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `MYSQL_ROOT_PASSWORD`                                                                       | `gameshelf-root`                                  | Applied only when `./data/mysql` is first initialized                                                         |
| `MYSQL_USER` / `MYSQL_PASSWORD`                                                             | `gameshelf` / `gameshelf`                         | Same; a password with URL-reserved characters must be URL-encoded                                             |
| `MYSQL_DATABASE`                                                                            | `gameshelf`                                       |                                                                                                               |
| `SESSION_SECRET`                                                                            | `gameshelf-local-docker-session-secret-change-me` | Local use only; set your own (32+ chars). Changing it logs everyone out and makes a stored LLM key unreadable |
| `SESSION_TTL_MINUTES`                                                                       | `10080`                                           |                                                                                                               |
| `SESSION_COOKIE_SECURE`                                                                     | `false`                                           | Plain HTTP on localhost/LAN                                                                                   |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET`                                                     | blank                                             | Needed for game lookups and photo import; not needed to boot                                                  |
| `IGDB_TOKEN_URL`, `CUSTOM_API_KEY`, `LLM_MODEL`, `LLM_SETTINGS_SECRET`, `MOBYGAMES_API_KEY` | blank                                             | Blank means not configured                                                                                    |
| `WEB_PORT` / `API_PORT` / `MYSQL_PORT`                                                      | `3000` / `3001` / `3306`                          | Host ports only; containers always listen on 3000 / 3001 / 3306                                               |

Fixed values: `NODE_ENV=production` (so the dev-only `db:seed` and
`db:clear-dev` refuse to run in the containers), `COVERS_DIR=/data/covers`,
`NEXT_PUBLIC_API_URL=http://api:3001`. `IMPORT_PHOTOS_DIR` keeps its default
(the container's temp directory).

# Data and persistence

- **Library:** `./data/mysql`, a host bind mount shared with the Node-based
  flow. Back it up as described in the README, "Backup and restore". The
  `docker compose exec mysql …` commands there work unchanged.
- **Covers:** the `covers` named volume (`<project>_covers`). It survives
  `docker compose down` but is deleted by `docker compose down -v`. Missing
  covers can be fetched again with
  `docker compose exec api npm run covers:redownload`.
- **Uploaded photos waiting to import:** the container's temp directory. They
  survive a restart but not container recreation (`down`, a rebuild), so
  finish or dismiss running imports before upgrading.

# Everyday commands

| Task                    | Command                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| Start (build if needed) | `docker compose up --build -d`                                           |
| Logs                    | `docker compose logs -f api web`                                         |
| Status / health         | `docker compose ps`                                                      |
| Stop (keep data)        | `docker compose down`                                                    |
| Upgrade after a pull    | `docker compose up --build -d` (`migrate` applies new migrations first)  |
| Reset a password        | `docker compose exec api npm run user:passwd -- --email you@example.com` |
| Dev database only       | `docker compose up -d mysql`                                             |

# Out of scope

- Multi-arch builds and publishing images to a registry.
- Production hardening: TLS, a non-root user, read-only filesystems, secret
  management, a slimmed runtime image.
- Hot-reload development in containers (use `npm run dev`).
- Running the e2e test suite in containers.
