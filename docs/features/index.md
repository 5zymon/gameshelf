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
- [Photo Import Pipeline](/photo-import-pipeline.md) - the worker's per-photo pipeline: one vision call, IGDB validation, per-batch MySQL transactions, retry-only-unresolved, and photo deletion after completion.
- [Queue Pause on Configuration Error](/queue-pause-on-config-error.md) - a rejected/absent LLM, IGDB, or MobyGames credential fails the current photo, durably pauses the photo-import queue, surfaces the pause on batch progress, and resumes explicitly or when the LLM key is saved.
- [Anti-hallucination Validation](/anti-hallucination-validation.md) - no `Game` row without external confirmation: the ordered IGDB → MobyGames → unrecognized chain, transient short-circuit, unrecognized trace, and MANUAL-only bypass.
- [MobyGames Fallback](/mobygames-fallback.md) - a rate-limited MobyGames v2 client (1 req/s, 720 req/h that waits) consulted only for titles IGDB missed, mapped onto the shared candidate shape with MobyGames provenance, degrading to IGDB-only when no key is configured.
- [IGDB Client & Rate Limiter](/igdb-client.md) - one IGDB client: Twitch client-credentials auth, cached/refreshable token, a central 4 req/s / 8-concurrent limiter, internal 429 backoff, two-phase IGDB batching (batched id search + batched hydration, ≤10 sub-queries and ≤500 ids per request), and an unauthenticated `GET /health/igdb` probe.
- [Game Metadata Enrichment](/game-metadata-enrichment.md) - one reusable candidate→`Game` mapping (title/platform/year/publisher/genre/playerCount, vision-only edition) plus a minimal local cover cache served same-origin at `/api/covers/<file>`, with honest source/enrichedAt and never-queried raw archival.
- [Game Re-enrichment](/game-reenrichment.md) - `POST /games/:id/enrich` re-runs IGDB → MobyGames → unresolved against a game's current (corrected) title, returns the candidate, and applies fresh metadata in place without duplicating the row or overwriting title/platform/edition or hand-edited (provenance-tracked) fields.
- [Manual Add with DB Search and Copy Count](/manual-add-and-copy-count.md) - `GET /games/search` (debounce-protected external search) plus `POST /games` with an optional picked candidate or typed-only data; one shared identity rule (reused by the import commit) turns an existing identity into a `409` carrying the game, `POST /games/:id/copies` increments the new `copyCount`, and imports link duplicates without incrementing.
- [Local Cover Cache](/local-cover-cache.md) - downloaded game covers stored in `COVERS_DIR`, locally generated WebP catalog thumbnails, same-origin serving (`/covers/:file`, `/covers/thumbs/:file`, `/covers/preview`), a `@Interval` background retry (ADR-002: no second queue), ref-counted deletion/replacement, and the `covers:redownload` repair command.
- [Photo Lifecycle & Retention](/photo-lifecycle.md) - ephemeral photo lifecycle: kept while queued/retryable, deleted on completion, swept when orphaned or past the failed-retry window.
- [Vision Provider Abstraction](/vision-provider-abstraction.md) - one `VisionProvider` interface with swappable Gemini/OpenAI backends behind a registry and `VisionService` seam, and a list-based (never count-based) recognition contract.
- [LLM Settings API](/llm-settings-api.md) - `GET`/`PUT /settings/llm` and `POST /settings/llm/test`: runtime provider/model/key config, encrypted-at-rest key, and the import gate.
- [Platforms API](/platforms-api.md) - platform CRUD with game counts, rename-preserving aliases, merge/confirm, delete-or-hide rules, import-created platforms, and the canonical IGDB platform list synced locally by `npm run platforms:sync`.
- [Web Auth UI](/web-auth-ui.md) - browser login/setup flows, the authenticated navigation shell (catalog/platforms/import/settings), layered server-side route protection, the same-origin `/api` rewrite, and the cookie-only (no token) auth guarantee, with a manual acceptance script.
- [Single-Origin Frontend & API with Strict CSP](/single-origin-frontend-api.md) - one origin via the `/api` rewrite, first-party session cookie, nonce-based `'self'`-only CSP, and build-time self-hosted fonts.
- [User CLI](/user-cli.md) - operator-run `user:create`/`user:passwd` commands that reuse `UsersService`, prompt for the password without echoing it, and need no email infrastructure.
