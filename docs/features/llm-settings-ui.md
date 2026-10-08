---
type: Feature
title: LLM Settings UI
description: The /settings screen — provider/model/API-key configuration, a saved-config connection test, game-database status, and a platform-refresh action.
tags: [web, settings, ui, llm]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-08T03:17:05Z }
---

# Overview

The `/settings` route is the operator's screen for the runtime configuration the
import pipeline depends on. It replaces the placeholder that was rendered since
ticket 0.x and wires three concerns into one page:

1. **LLM provider, model and API key** — read and written through
   [`GET`/`PUT /settings/llm`](/llm-settings-api.md). The key is write-only: the
   browser never receives it, and the form never seeds its input from the server.
2. **Game-database status** — a read of the new
   [`GET /settings/game-databases`](/platforms-api.md) endpoint showing whether
   IGDB and MobyGames are configured.
3. **Reference-platform refresh** — a button that calls the new
   [`POST /platforms/refresh`](/platforms-api.md), which re-runs the IGDB
   platform reconcile and restores hidden reference platforms.

Recommended default provider: **Google Gemini** (`gemini-3.8-flash`) — a
generous free tier, fast, reliable at reading box text. OpenAI (`gpt-4o-mini`)
is a solid paid alternative. Each photo costs one vision call (a fraction of a
cent to a few cents depending on provider and image size); recognition is only
charged for imported photos. The screen states this in its copy.

# Routes and components

| Route       | Server page                   | Client/server components                                                                           |
| ----------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `/settings` | `app/(app)/settings/page.tsx` | `LlmSettingsForm` (client), `GameDatabaseStatusPanel` (server), `RefreshPlatformsControl` (client) |

The page is `force-dynamic` and calls `requireUser()`. It fetches the LLM
settings and the game-database status with `Promise.allSettled`, so one failing
resource does not blank the page: a failed LLM fetch shows a retry message where
the form would be, and a failed status fetch shows its own message.

# `LlmSettingsForm`

The form is driven entirely by the `LlmSettingsModel` returned by the API (and,
after a save, by the authoritative `PUT` response kept in local state).

- **Provider** — a `<select>` populated from
  `settings.availableProviders` (Google Gemini, OpenAI). Changing it resets the
  local model to that provider's default and clears any typed key, matching the
  backend rule that a key/model belongs to the provider that stored it.
- **Model** — a text input capped at 128 chars (the backend
  `LLM_MODEL_MAX_LENGTH`). The provider default is shown as the placeholder;
  leaving it at the default omits `model` from the request, while clearing it
  sends `""` to drop a stored override.
- **API key** — see below.

Only changed keys are sent. `model` is omitted when it equals the saved model
(or the new provider's default), and `apiKey` is omitted unless the user typed
one or chose to remove the key. **Save** is disabled while saving or when the
form is not dirty.

# Key handling (write-only)

The key is never rendered back. The server model exposes only `keyPresent`, so:

- When a key is present for the active provider, the field is replaced by
  "A key is saved for <provider>." plus **Replace key** and **Remove key**.
- **Replace key** reveals an empty password input (`type="password"`,
  `autoComplete="new-password"`).
- **Remove key** shows "The key will be removed when you save." plus **Undo**;
  saving sends `apiKey: ""`.
- Otherwise an empty password input is shown with the helper "It is stored
  encrypted and never shown again."

Guarantees:

- The form submits with `onSubmit` + `event.preventDefault()` and never puts the
  key in a query string or the URL.
- The component never logs the key, the request body, or the response.
- The input is never seeded from `settings` (the model carries no key).

# Test connection

**Test connection** calls `POST /settings/llm/test`, which tests the **saved**
configuration — the form says so and flags unsaved edits. The endpoint always
returns HTTP 200; the component maps the stable `code` to a specific message
(falling back to a generic message on a request-level network failure):

| `VisionTestCode`   | Message shown                                                          |
| ------------------ | ---------------------------------------------------------------------- |
| `ok`               | Connection succeeded — the provider accepted the request.              |
| `not_configured`   | No API key is saved for this provider yet. Save a key first.           |
| `unauthorized`     | The provider rejected the API key. Check the key and try again.        |
| `model_not_found`  | The configured model does not exist for this provider. Choose another. |
| `rate_limited`     | The provider rate-limited the request. Wait a moment and try again.    |
| `timeout`          | The provider did not respond in time. Try again.                       |
| `bad_response`     | The provider returned an unexpected response.                          |
| `network`          | Couldn't reach the provider. Check the connection and try again.       |
| `server_error`     | The provider had a server error. Try again later.                      |
| `unknown_provider` | That provider is not available.                                        |

`ok` renders as `role="status"`; any failure renders as `role="alert"` in the
danger style.

# Game database status

`GameDatabaseStatusPanel` renders the two entries from
`GET /settings/game-databases`:

| State        | Label          | Meaning                                                        |
| ------------ | -------------- | -------------------------------------------------------------- |
| `configured` | Configured     | The provider's env key(s) are present (and not paused)         |
| `missing`    | Not configured | The env key(s) are absent                                      |
| `rejected`   | Key rejected   | The durable `import_queue_state` row is paused for that source |

The status is derived **without a network call**:

- `missing` when the provider's env key(s) are absent
  (`IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET`, or `MOBYGAMES_API_KEY`).
- `rejected` when the singleton `import_queue_state` row is paused with
  `source === id` — the exact place the [photo-import pipeline](/queue-pause-on-config-error.md)
  records "the provider rejected the credentials", with its reason.
- otherwise `configured`.

Trade-off: a live probe was rejected because a MobyGames request goes through
`MobygamesRateLimiter`, which **waits** when saturated (up to an hour) and would
block the settings render. Consequence: a bad game-database key shows `rejected`
only after an import has failed with a config error (or an operator has caused
one); immediate game-database rejection detection is out of scope. The card
requests a test button only for the LLM.

# Refresh platforms

`RefreshPlatformsControl` calls `POST /platforms/refresh`, which re-runs the
same `PlatformsSyncService` reconcile as the operator command (see
[Platforms API](/platforms-api.md)). On success it reports
`fetched / created / updated / unchanged` and calls `router.refresh()`. On a
`503` it shows the API's message (IGDB not configured/rejected, or unreachable).

The refresh **restores hidden reference platforms**: `PlatformsService.updateCanonical`
now treats a hidden row as changed even when every canonical field already
matches, clearing `hidden`. Nothing is ever deleted, so a reference platform
hidden via `DELETE /platforms/:id` comes back (still the same row) after a
refresh.

# Manual acceptance script

1. Open `/settings`. The provider select lists Google Gemini and OpenAI; the
   model is prefilled; the key field is empty; the recommended-default copy
   names Gemini.
2. Paste a key, **Save changes** → "Saved. Photo import is enabled." with a link
   to `/import`. Open `/import`: the gate is gone and the picker is enabled.
3. Reload `/settings`: the key input is empty and shows "A key is saved"; no key
   text appears in the DOM; the request is `PUT /settings/llm` with the key only
   in the JSON body; the console shows no key.
4. **Test connection** → success. Save a bad key, test again → "The provider
   rejected the API key…".
5. **Remove key**, **Save changes** → the "no key" state returns and the
   `/import` gate comes back.
6. The game databases panel lists IGDB and MobyGames with Configured / Not
   configured / Key rejected.
7. **Refresh platforms** → a success summary; a previously hidden reference
   platform reappears (`hidden: false`, the same row).
8. The console shows no CSP violations.

# Related

- [LLM Settings API](/llm-settings-api.md) — the backing endpoints.
- [Platforms API](/platforms-api.md) — `POST /platforms/refresh` and the delete/hide rules.
- [Photo Import Upload UI](/photo-import-upload-ui.md) — the import gate this screen enables.
- [Web API Client](/web-api-client.md) — `settings.llm.*`, `settings.gameDatabases.status`, `platforms.refresh`.

# Out of scope

- Immediate game-database (IGDB/MobyGames) rejection probing — status is derived
  from config plus the durable import pause (see above).
- Language and theme settings (tickets 7.2 / 7.3).
- Anthropic/other providers; per-provider key storage for several providers at
  once; key rotation/audit tooling.
- The full `/platforms` management view (still a placeholder).
- A frontend test runner; verification is typecheck + lint + build plus the
  manual acceptance script.
