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

## Feature documentation: OKF, required

All documented features MUST use **Open Knowledge Format (OKF) v0.2**. Feature docs live in the `docs/features/` bundle.

- Spec: https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
- Before adding, changing, or moving anything under `docs/`, read `docs/AGENTS.md` — it defines the bundle layout, required frontmatter, and conformance rules.
