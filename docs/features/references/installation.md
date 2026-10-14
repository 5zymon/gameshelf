---
type: Guide
title: Installation & First Run
description: Scope, prerequisites, one-command and manual setup, running the app (ports, LAN access), and how accounts are provisioned without public sign-up.
tags: [operations, setup, install, accounts]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-14T11:52:50.449Z }
---

# Overview

How to get GameShelf from a clean clone to a running app and a first account. This text was the root README's operator guide until 2026-10-14; the README now links here. Configuration is in [Configuration & External Services](/references/configuration.md), and backups and health checks are in [Database, Backups & Operational Checks](/references/operations.md).

# Scope

GameShelf is a **single-user, single-origin** app for one operator's own library.
Two things are deliberately out of scope, and **no requirement in this project
depends on them**:

- **Deployment is out of scope.** There is no production deployment story — no
  reverse proxy, no TLS terminator, no load balancing, no multi-instance setup.
  The app runs on one host, reachable at `http://localhost` (or a LAN IP), by its
  operator.
- **No requirement depends on a container.** `docker-compose.yml` is a
  _convenience_ that starts a local MySQL. The application has no
  dependency on Docker or on that file: it needs only a MySQL 8.4 server
  reachable at the host and port in `DATABASE_URL`.
  System-installed servers work identically.

# Prerequisites

- **Node.js 24 LTS** (`>=24 <25`) — pinned in `.nvmrc` and `package.json` (`engines.node`).
- **npm 11+** (ships with Node 24).
- [nvm](https://github.com/nvm-sh/nvm) (optional but recommended) to select the pinned Node version.
- **Docker** (optional) — only for the convenience `docker-compose.yml` that starts the dev MySQL. The app itself needs just a MySQL 8.4 server reachable at the host and port in `DATABASE_URL`; system-installed servers work identically.

The root scripts call `concurrently` and the workspace CLIs, so everything runs from the repository root.

# Setup

## One command

From a clean clone, one command takes you from nothing to a running, migrated,
client-generated local install:

```bash
npm run setup        # or: task setup
```

It runs, in order (idempotent — safe to re-run):

1. `npm install` — install both workspaces and set up git hooks.
2. `cp .env.example .env` — **only if `.env` is missing**, and generates a random
   `SESSION_SECRET` in the copy so you never ship the placeholder.
3. `docker compose up -d mysql` — start the pinned `mysql:8.4`
   (convenience only — see [Scope](#scope)).
4. Wait until MySQL reports **healthy**.
5. `npm run db:deploy` — apply the committed Prisma migrations (creates every
   table; `migrate deploy` needs no shadow DB).
6. `npm run db:generate` — generate the Prisma client (a gitignored build artifact).

Then start the app:

```bash
npm run dev          # API on :3001, web on :3000 (API_PORT / WEB_PORT)
```

Open <http://localhost:3000> (or your `WEB_PORT`) — the app redirects to `/setup` when no users exist; create your first account there.

## Manual fallback

If you prefer to do it by hand (or `task`/the script is unavailable):

```bash
nvm install && nvm use          # reads .nvmrc (Node 24)
npm install
cp .env.example .env            # then edit .env (at minimum set SESSION_SECRET)
docker compose up -d mysql
docker compose ps               # wait until it is "healthy"
npm run db:deploy               # apply committed migrations
npm run db:generate             # generate the Prisma client
npm run dev
```

`.env` is gitignored; `.env.example` lists every variable the app, its tests, and
`docker-compose.yml` read, with placeholder values only.

# Running

Start the API and the web app together with a single command:

```bash
npm run dev
```

`npm run dev` runs `concurrently` and starts:

- **API** — NestJS on `API_HOST:API_PORT`, default <http://localhost:3001> (health check at `/health`)
- **Web** — Next.js on `WEB_HOST:WEB_PORT`, default <http://localhost:3000>

Every root script is listed in the [Development Guide](/references/development.md#scripts).

## Reaching the app from another device (LAN)

Both servers bind every interface by default (`WEB_HOST` and `API_HOST` blank),
so a phone or another computer on the same network can use the app:

1. Optionally pick a port in `.env` (e.g. `WEB_PORT=4000`) and restart `npm run dev`.
2. Find this machine's LAN IP — Next prints a `Network:` URL on start, or on
   macOS run `ipconfig getifaddr en0`.
3. On the other device open `http://<LAN IP>:<WEB_PORT>` and sign in.

Only the web port has to be reachable: the browser talks to the web app alone,
which forwards `/api` to the API server-side (see [Single-Origin Frontend & API with Strict CSP](/single-origin-frontend-api.md)),
so no CORS, cookie or CSP setting changes. Keep `SESSION_COOKIE_SECURE=false` on
plain HTTP. Set `API_HOST=127.0.0.1` (with
`NEXT_PUBLIC_API_URL=http://127.0.0.1:<API_PORT>`) to keep the API off the network,
or `WEB_HOST=127.0.0.1` to keep the whole app on this machine. Allow incoming
connections for `node` if the OS firewall asks. In dev, Next may log a
"Cross origin request detected … allowedDevOrigins" warning for a LAN address; it
is informational and does not block the page or hot reload.

# Accounts and registration

GameShelf has **no public self-registration**. There is deliberately no signup
route or signup link, and paths such as `POST /auth/register`, `POST /signup`
or `POST /users` return `404`. This is a security decision, not an unfinished
feature — do not "helpfully" add a public registration endpoint. The absence
is enforced by the regression test
`apps/api/test/e2e/no-registration.e2e-spec.ts` (part of `npm run test`).

Accounts are provisioned only by:

- **First-run setup** — `POST /setup` creates the very first account and is
  permanently disabled (`409 Setup has already been completed`) once a user
  exists. See [First-run Setup](/first-run-setup.md).
- **The CLI** — operator-run commands that reuse `UsersService`, for when the
  first account already exists (or the only account is locked out):
  - `npm run user:create` — create an account. It prompts for `Email: ` (unless
    `--email <email>` is given), then `Password: ` and `Confirm password: `
    without echoing them.
  - `npm run user:passwd` — set a new password (the account-recovery path: there
    is no email/SMTP reset flow).

  `--password <password>` / `--password=<password>` skips both password prompts
  and the confirmation, but it shows up in shell history and `ps`, so prefer the
  stdin pipe when running non-interactively (off a TTY, `--email` is required):

  ```bash
  printf '%s\n' "$NEW_PASSWORD" | npm run user:passwd -- --email player@example.com
  ```

  Failures — missing `--email` off a TTY, blank email, empty password, password
  mismatch, duplicate email on create, unknown email on passwd — print a
  readable message to stderr and exit non-zero. Validation and hashing use the
  same code path as first-run setup (`UsersService.prepareUser`); the CLI adds
  no separate rules. See
  [User CLI](/user-cli.md).

- **Dev seed** — `npm run db:seed` (development only) creates
  `qa@gameshelf.local` / `gameshelf-qa-password` for QA, plus a small sample
  catalog. It is idempotent: re-running resets the password and never
  duplicates games. It needs `NODE_ENV=development` (set in `.env.example`)
  or it refuses to run. See
  [Dev Seed](/dev-seed.md).

Additional users therefore require operator action. The web client exposes no
signup page or link either; that is enforced by the frontend ticket.
