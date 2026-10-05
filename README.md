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
| `npm run typecheck`    | Type-check both workspaces          |
| `npm run lint`         | Lint both workspaces                |
| `npm run lint:fix`     | Lint both workspaces and autofix    |
| `npm run format`       | Format the whole repo with Prettier |
| `npm run format:check` | Check formatting without writing    |

### Code quality and git hooks

ESLint runs the typed `strictTypeChecked` and `stylisticTypeChecked` presets, while Prettier owns formatting (conflicting ESLint rules are disabled via `eslint-config-prettier`).

`npm install` runs `husky`, which points Git at `.husky/`. The `pre-commit` hook runs `lint-staged` (ESLint `--fix` + Prettier on staged files) and then a full `npm run typecheck`; commits that fail either check are rejected.

## Environment variables

All variables live in a single root `.env` file (see `.env.example`):

| Variable              | Used by    | Purpose                              |
| --------------------- | ---------- | ------------------------------------ |
| `NODE_ENV`            | both       | Runtime environment                  |
| `API_PORT`            | `apps/api` | API listen port (default `3001`)     |
| `API_HOST`            | `apps/api` | API bind address                     |
| `WEB_PORT`            | `apps/web` | Web dev server port (default `3000`) |
| `NEXT_PUBLIC_API_URL` | `apps/web` | Browser-facing API base URL          |
| `DATABASE_URL`        | `apps/api` | PostgreSQL connection string         |
| `REDIS_URL`           | `apps/api` | Redis connection string              |
| `SESSION_SECRET`      | `apps/api` | Secret used to sign session cookies  |
| `OPENAI_API_KEY`      | `apps/api` | LLM provider key                     |
| `ANTHROPIC_API_KEY`   | `apps/api` | LLM provider key                     |
| `IGDB_CLIENT_ID`      | `apps/api` | IGDB credentials                     |
| `IGDB_CLIENT_SECRET`  | `apps/api` | IGDB credentials                     |

## Repository layout

```
.
├── apps/
│   ├── api/            # NestJS API
│   └── web/            # Next.js frontend
├── docs/               # OKF feature documentation bundle
├── tsconfig.base.json  # Shared strict TypeScript config
├── .husky/             # Git hooks (pre-commit)
├── .env.example        # Environment variable template
├── .nvmrc              # Pinned Node version
└── package.json        # Workspaces + root scripts
```
