---
okf_version: '0.2'
---

# Features

- [Auth Foundation](/auth-foundation.md) - Argon2id password hashing, server-side sessions (HMAC-stored ids, finite sliding TTL), and env-only auth config.
- [Auth API](/auth-api.md) - `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, the `gameshelf_session` httpOnly cookie, and the global `SessionGuard` (with `@Public()` opt-outs).
- [First-run Setup](/first-run-setup.md) - one-time `GET /setup/status` / `POST /setup` bootstrap that creates the first account and is permanently disabled once one exists.
- [Catalog API](/catalog-api.md) - `GET /games`: paginated, filterable, searchable, sortable game listing with available filter values.
- [Import Jobs API](/import-jobs-api.md) - persisted import runs (status, counts, flagged items), dismissal, and the indefinite retention policy.
- [Import Photo Upload API](/import-upload-api.md) - `POST /import/upload`: multi-photo upload, optional per-photo declared counts, ephemeral storage, and background queuing.
- [Vision Provider Abstraction](/vision-provider-abstraction.md) - one `VisionProvider` interface with swappable Gemini/OpenAI backends behind a registry and `VisionService` seam, and a list-based (never count-based) recognition contract.
- [LLM Settings API](/llm-settings-api.md) - `GET`/`PUT /settings/llm` and `POST /settings/llm/test`: runtime provider/model/key config, encrypted-at-rest key, and the import gate.
- [Platforms API](/platforms-api.md) - platform CRUD with game counts, 409 duplicate/delete rules, and the canonical IGDB platform seed.
- [Web Auth UI](/web-auth-ui.md) - browser login/setup flows, the authenticated navigation shell (catalog/platforms/import/settings), layered server-side route protection, the same-origin `/api` rewrite, and the cookie-only (no token) auth guarantee, with a manual acceptance script.
- [User CLI](/user-cli.md) - operator-run `user:create`/`user:passwd` commands that reuse `UsersService`, prompt for the password without echoing it, and need no email infrastructure.
