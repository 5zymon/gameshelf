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
[Import Photo Upload API](/import-upload-api.md) uses to decide whether photo
recognition is available.

The API key is write-only: it is encrypted at rest and **never** returned by any
endpoint or written to a log. The selected backend is consumed through the
[Vision Provider Abstraction](/vision-provider-abstraction.md).

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
  "provider": "gemini",
  "model": "gemini-3.8-flash",
  "baseUrl": null,
  "keyPresent": true,
  "importEnabled": true,
  "availableProviders": [
    {
      "id": "gemini",
      "label": "Google Gemini",
      "defaultModel": "gemini-3.8-flash"
    },
    { "id": "openai", "label": "OpenAI", "defaultModel": "gpt-4o-mini" },
    {
      "id": "custom",
      "label": "Custom (OpenAI-compatible)",
      "defaultModel": ""
    }
  ],
  "updatedAt": null
}
```

`keyPresent` and `importEnabled` are the same value: an API key is available for
the active provider. `baseUrl` is the `custom` provider's OpenAI-compatible
endpoint (the stored, normalized value) and is `null` for the built-in
providers — it is **not** a secret, so it is returned and shown in the UI.
`updatedAt` is `null` until a settings row has been written. There is
deliberately no key field.

## PUT /settings/llm

Body `{ provider, model?, baseUrl?, apiKey? }`:

| Field      | Required | Rules                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider` | yes      | `gemini`, `openai`, or `custom` (anything else → `400`)                                                                                                                                                                                                                                                                                                                                                                 |
| `model`    | no       | string ≤ 128; omit keeps for the same `provider`, but resets to the provider default when `provider` changes; `""` clears to the default                                                                                                                                                                                                                                                                                |
| `baseUrl`  | no       | string ≤ 512. **`custom` only**: required when saving `custom` (an absolute `http://`/`https://` URL; stored normalized to `origin + pathname` with the trailing `/` stripped) — a missing, empty, or non-absolute value → `400`. Omit when the provider is already `custom` to keep the stored URL. **`openai`/`gemini`**: must be omitted or empty (fixed endpoints) — otherwise `400`; the stored column is cleared. |
| `apiKey`   | no       | string ≤ 512, write-only; omit keeps for the same `provider`, but is cleared when `provider` changes; `""` clears                                                                                                                                                                                                                                                                                                       |

Unknown fields are rejected (`400`) by the global validation pipe. The response
is the same shape as `GET`. The service validates the provider against the
registry as well, so a direct (non-HTTP) call cannot store an unknown provider.
The `baseUrl` cross-field rules are enforced in the service (not the DTO), so a
direct (non-HTTP) call cannot store a base URL for a built-in provider or a
missing one for `custom`.

# Test endpoint

`POST /settings/llm/test` makes one real provider call with a valid 1x1 PNG and
**always returns HTTP 200**. A completed-but-failed test is reported in the body:

```json
{ "ok": true,  "code": "ok",           "provider": "gemini", "model": "gemini-3.8-flash", "message": "..." }
{ "ok": false, "code": "unauthorized", "provider": "gemini", "model": "gemini-3.8-flash", "message": "..." }
{ "ok": false, "code": "not_configured", "provider": "gemini", "model": "gemini-3.8-flash", "message": "..." }
```

| Code               | Meaning                                                       |
| ------------------ | ------------------------------------------------------------- |
| `ok`               | The provider accepted the request                             |
| `not_configured`   | No key is available for the active provider                   |
| `unknown_provider` | Defensive-only; the current resolution path never produces it |
| `unauthorized`     | `401`/`403` from the provider (bad key)                       |
| `model_not_found`  | `404` (unknown model)                                         |
| `rate_limited`     | `429`                                                         |
| `timeout`          | No response within the client timeout                         |
| `bad_response`     | Non-JSON / malformed / schema-invalid model output            |
| `network`          | The provider could not be reached                             |
| `server_error`     | `5xx` (or an unexpected error)                                |

# Key precedence and encryption

For the active provider, the key is resolved in order:

1. the encrypted `llm_settings.api_key_ciphertext` (only when the row's
   provider matches the active provider), then
2. the provider's env var (`GEMINI_API_KEY` / `OPENAI_API_KEY` /
   `CUSTOM_API_KEY`), then
3. none — recognition is disabled.

The active provider is the stored row's provider when valid, else
`LLM_PROVIDER`, else `gemini`. The model is the stored row's model (same
provider only), else `LLM_MODEL`, else the provider's `defaultModel` (empty
for `custom` — the user always types one). The base URL is the stored row's
`base_url` (custom rows only); there is no env override for it.

A stored key, model, or base URL belongs to the provider that stored it. When
`PUT` changes `provider` without supplying `apiKey`/`model`, both are reset to
`null` and resolution falls through to the new provider's env key and default
model, so the previous provider's secret is never sent to the new backend.
Switching to `custom` requires a `baseUrl` in the same request (there is no
stored URL to keep); switching away from `custom` clears the column.

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

`POST /import/upload` (see [Import Photo Upload API](/import-upload-api.md))
calls `LlmSettingsService.isConfigured()`. When it is `false`, the upload is
refused with `503` **before storing or enqueuing anything**. When `true`, the
upload proceeds unchanged.

# Out of scope

- The recognition pipeline (ticket 3.5). The frontend screen is
  [LLM Settings UI](/llm-settings-ui.md).
- Anthropic and other providers (the registry makes adding one cheap).
- Key rotation tooling, audit history, retry/backoff, and rate limiting.
