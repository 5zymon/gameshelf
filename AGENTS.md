# AGENTS.md

Instructions for agents working in the **GameShelf** repository.

## Installed skills

This project ships four OpenCode skills in `.opencode/skills/`. They are auto-discovered; load the matching one with the `skill` tool before starting relevant work.

| Skill ID                      | Use when                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `vercel-react-best-practices` | Writing, reviewing, or refactoring React/Next.js code: components, data fetching, bundle optimization, performance.   |
| `nestjs-best-practices`       | Writing, reviewing, or refactoring NestJS code: modules, dependency injection, security, performance, architecture.   |
| `tailwind-best-practices`     | Styling with Tailwind CSS: responsive design, dark mode, reusable component styles, configuration, v3 → v4 migration. |
| `frontend-design`             | Designing or reshaping user-facing UI: aesthetic direction, typography, palette, layout.                              |

`.opencode/skills/manifest.json` records the upstream source (pinned commits) and licenses of the vendored skills.

## Feature documentation: OKF, required

All documented features MUST use **Open Knowledge Format (OKF) v0.2**. Feature docs live in the `docs/features/` bundle.

- Spec: https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
- Before adding, changing, or moving anything under `docs/`, read `docs/AGENTS.md` — it defines the bundle layout, required frontmatter, and conformance rules.

## QA / test account

Seed a known account and sample data before QA or manual testing (dev database only — refuses unless `NODE_ENV=development`, which `.env.example` sets; safe to re-run):

```bash
npm run db:seed
```

| Email                | Password                |
| -------------------- | ----------------------- |
| `qa@gameshelf.local` | `gameshelf-qa-password` |

- Log in at `http://localhost:3000/login` with this account when testing the app, or create your own with `npm run user:create -- --email <email> --password <password>`. There is no signup page.
- Re-running resets this account's password and never duplicates games. For a clean catalog: `npm run db:clear-dev -- --force && npm run db:seed`.
- Seeding creates a user, which closes first-run setup (`/setup`). Do not seed if you need to test setup.
- Never use these credentials outside local development. Details: `docs/features/dev-seed.md`.
