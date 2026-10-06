---
okf_version: '0.2'
---

# Features

- [Auth Foundation](/auth-foundation.md) - Argon2id password hashing, server-side sessions (HMAC-stored ids, finite sliding TTL), and env-only auth config.
- [Auth API](/auth-api.md) - `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, the `gameshelf_session` httpOnly cookie, and the global `SessionGuard` (with `@Public()` opt-outs).
- [First-run Setup](/first-run-setup.md) - one-time `GET /setup/status` / `POST /setup` bootstrap that creates the first account and is permanently disabled once one exists.
- [Catalog API](/catalog-api.md) - `GET /games`: paginated, filterable, searchable, sortable game listing with available filter values.
- [Import Jobs API](/import-jobs-api.md) - persisted import runs (status, counts, flagged items), dismissal, and the indefinite retention policy.
- [Platforms API](/platforms-api.md) - platform CRUD with game counts, 409 duplicate/delete rules, and the canonical IGDB platform seed.
- [Web Auth UI](/web-auth-ui.md) - browser login/setup flows, the authenticated navigation shell (catalog/platforms/import/settings), layered server-side route protection, the same-origin `/api` rewrite, and the cookie-only (no token) auth guarantee, with a manual acceptance script.
