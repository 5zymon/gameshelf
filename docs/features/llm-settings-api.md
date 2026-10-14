---
type: Feature
title: LLM Settings API
description: Runtime LLM provider/model/API-key configuration with encrypted-at-rest key storage and a live connectivity test.
tags: [api, settings, llm]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-06T00:00:00Z }
---

# Overview

The LLM provider and model must be configurable after first run without editing
env files or restarting. This feature adds a singleton settings row
(`llm_settings.id = 1`), an authenticated read/write API, a live connectivity
test, and the gate the
[Import Photo Upload API](import-upload-api.md) uses to decide whether photo
recognition is available.

The API key is write-only: it is encrypted at rest and **never** returned by any
endpoint or written to a log. The selected backend is consumed through the
[Vision Provider Abstraction](vision-provider-abstraction.md).

# Endpoints

All routes require authentication (the global `SessionGuard`; there is no
`@Public()` opt-out).

| Method | Path                 | Purpose                      | Success                    | Errors       |
| ------ | -------------------- | ---------------------------- | -------------------------- | ------------ |
| `GET`  | `/settings/llm`      | Read settings (no key)       | `200` `LlmSettingsModel`   | `401`        |
| `PUT`  | `/settings/llm`      | Update provider/model/key    | `200` `LlmSettingsModel`   | `400`, `401` |
| `POST` | `/settings/llm/test` | One real call with a 1x1 PNG | `200` `LlmTestResultModel` | `401`        |

## GET /settings/llm

```json
{
  "provider": "custom",
  "model": "llava:7b",
  "baseUrl": "http://localhost:11434/v1",
  "keyPresent": true,
  "importEnabled": true,
  "availableProviders": [
    {
      "id": "custom",
      "label": "Custom (OpenAI-compatible)",
      "defaultModel": ""
    }
  ],
  "updatedAt": null
}
```

`importEnabled` is `keyPresent` **and** a non-null `baseUrl`: recognition can
run only when both an API key and a base URL are available. `baseUrl` is the
OpenAI-compatible endpoint's base URL (the stored, normalized value) and is
`null` until one is saved — it is **not** a secret, so it is returned and shown
in the UI. `updatedAt` is `null` until a settings row has been written. There
is deliberately no key field.

## PUT /settings/llm

Body `{ provider, model?, baseUrl?, apiKey? }`:

| Field      | Required | Rules                                                                                                                                                                                                                                                                |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider` | yes      | `custom` (anything else, including the removed `gemini`/`openai`, → `400`)                                                                                                                                                                                           |
| `model`    | no       | string ≤ 128; omit keeps the stored model, `""` clears the override; switching away from a legacy row resets it                                                                                                                                                      |
| `baseUrl`  | no       | string ≤ 512; an absolute `http://`/`https://` URL, stored normalized to `origin + pathname` with the trailing `/` stripped. Required unless one is already stored on a `custom` row — a missing, empty, or non-absolute value → `400`. Omit to keep the stored URL. |
| `apiKey`   | no       | string ≤ 512, write-only; omit keeps the stored key (a key stored by a removed provider is never reused), `""` clears; switching away from a legacy row resets it                                                                                                    |

Unknown fields are rejected (`400`) by the global validation pipe. The response
is the same shape as `GET`. The service validates the provider against the
registry as well, so a direct (non-HTTP) call cannot store an unknown provider.
The `baseUrl` rules are enforced in the service (not the DTO), so a direct
(non-HTTP) call cannot store a missing or non-absolute base URL.

# Test endpoint

`POST /settings/llm/test` makes one real provider call with a valid 1x1 PNG and
**always returns HTTP 200**. A completed-but-failed test is reported in the body:

```json
{ "ok": true,  "code": "ok",           "provider": "custom", "model": "llava:7b", "message": "..." }
{ "ok": false, "code": "unauthorized", "provider": "custom", "model": "llava:7b", "message": "..." }
{ "ok": false, "code": "not_configured", "provider": "custom", "model": "llava:7b", "message": "..." }
```

| Code               | Meaning                                                       |
| ------------------ | ------------------------------------------------------------- |
| `ok`               | The provider accepted the request                             |
| `not_configured`   | No API key or no base URL                                     |
| `unknown_provider` | Defensive-only; the current resolution path never produces it |
| `unauthorized`     | `401`/`403` from the provider (bad key)                       |
| `model_not_found`  | `404` (unknown model)                                         |
| `rate_limited`     | `429`                                                         |
| `timeout`          | No response within the client timeout                         |
| `bad_response`     | Non-JSON / malformed / schema-invalid model output            |
| `network`          | The provider could not be reached                             |
| `server_error`     | `5xx` (or an unexpected error)                                |

# Key precedence and encryption

The key is resolved in order:

1. the encrypted `llm_settings.api_key_ciphertext` (only when the row's
   provider is the active provider), then
2. `CUSTOM_API_KEY`, then
3. none — recognition is disabled.

The active provider is the stored row's provider when registered, else
`custom`. There is no `LLM_PROVIDER` env var. A legacy `gemini`/`openai` row
resolves to `custom`, but its stored model and key are never used, and with no
base URL it stays not configured until the user saves one. The model is the
stored row's model (same provider only), else `LLM_MODEL`, else the provider's
`defaultModel` (empty for `custom` — the user always types one). The base URL
is the stored row's `base_url` (custom rows only); there is no env fallback
for it.

A stored key, model, or base URL belongs to the provider that stored it. When
`PUT` switches away from a legacy row without supplying `apiKey`/`model`, both
are reset to `null`, so the removed provider's secret is never sent anywhere.
Saving `custom` requires a `baseUrl` in the same request unless one is already
stored on a `custom` row.

The key is encrypted with AES-256-GCM. The 32-byte key is derived with
HKDF-SHA256 from `LLM_SETTINGS_SECRET`, falling back to `SESSION_SECRET`, so no
new mandatory secret is introduced. The stored payload format is
`v1:<b64url iv>:<b64url tag>:<b64url ciphertext>`. A decrypt failure (e.g. a
rotated secret) is logged **without any secret material** and treated as
"absent", so settings reads still work and fall through to the env var.

# Redaction guarantees

- No endpoint returns the API key or its ciphertext; `keyPresent` is a boolean.
- `PUT` and `test` responses are checked in e2e to never contain the submitted
  key substring.
- Logs contain provider/model/presence only.
- Provider errors carry a fixed message + code; the upstream body and request
  headers (which hold the key) are never surfaced.

# Import gate

`POST /import/upload` (see [Import Photo Upload API](import-upload-api.md))
calls `LlmSettingsService.isConfigured()`, which is true only when both an API
key and a base URL are available. When it is `false`, the upload is refused
with `503` **before storing or enqueuing anything**. When `true`, the upload
proceeds unchanged.

# Out of scope

- The recognition pipeline (ticket 3.5). The frontend screen is
  [LLM Settings UI](llm-settings-ui.md).
- Other protocols (Anthropic-native, Gemini-native); several providers at once
  (the registry makes adding one cheap).
- Key rotation tooling, audit history, retry/backoff, and rate limiting.
