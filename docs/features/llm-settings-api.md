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
  "keyPresent": true,
  "importEnabled": true,
  "availableProviders": [
    {
      "id": "gemini",
      "label": "Google Gemini",
      "defaultModel": "gemini-3.8-flash"
    },
    { "id": "openai", "label": "OpenAI", "defaultModel": "gpt-4o-mini" }
  ],
  "updatedAt": null
}
```

`keyPresent` and `importEnabled` are the same value: an API key is available for
the active provider. `updatedAt` is `null` until a settings row has been
written. There is deliberately no key field.

## PUT /settings/llm

Body `{ provider, model?, apiKey? }`:

| Field      | Required | Rules                                                        |
| ---------- | -------- | ------------------------------------------------------------ |
| `provider` | yes      | `gemini` or `openai` (anything else → `400`)                 |
| `model`    | no       | string ≤ 128; omit to keep, empty clears back to the default |
| `apiKey`   | no       | string ≤ 512, write-only; omit keeps, `""` clears            |

Unknown fields are rejected (`400`) by the global validation pipe. The response
is the same shape as `GET`. The service validates the provider against the
registry as well, so a direct (non-HTTP) call cannot store an unknown provider.

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
2. the provider's env var (`GEMINI_API_KEY` / `OPENAI_API_KEY`), then
3. none — recognition is disabled.

The active provider is the stored row's provider when valid, else
`LLM_PROVIDER`, else `gemini`. The model is the stored row's model (same
provider only), else `LLM_MODEL`, else the provider's `defaultModel`.

A stored key or model belongs to the provider that stored it. When `PUT`
changes `provider` without supplying `apiKey`/`model`, both are reset to `null`
and resolution falls through to the new provider's env key and default model,
so the previous provider's secret is never sent to the new backend.

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

- The recognition pipeline (ticket 3.5) and the frontend settings screen.
- Anthropic and other providers (the registry makes adding one cheap).
- Key rotation tooling, audit history, retry/backoff, and rate limiting.
