---
type: Feature
title: Vision Provider Abstraction
description: One VisionProvider interface with a single Custom (OpenAI-compatible) backend behind a registry and a VisionService seam.
tags: [import, llm, architecture]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-09T21:21:30Z }
---

# Overview

Photo recognition must not hard-code a model vendor. This feature defines one
`VisionProvider` interface, one registry, and one `VisionService` facade. The
import pipeline (ticket 3.5 and later) will depend only on `VisionService`, so
the concrete backend and its model/key can change at runtime (through the
[LLM Settings API](/llm-settings-api.md)) or be swapped in code without touching
the pipeline.

One backend ships: **Custom** (OpenAI-compatible, user-supplied base URL and
free-text model). The Gemini and OpenAI backends were removed on 2026-10-12.
The prompt requires a JSON **list** of the games it can read and explicitly
forbids estimating a count — the model is the source of the list, never of the
number of games.

# Interface

`apps/api/src/settings/vision/vision-provider.ts`:

```ts
export const SUPPORTED_PROVIDER_IDS = ['custom'] as const;
export type VisionProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];

export interface RecognizedItem {
  title: string;
  edition: string | null;
  platform: string | null;
  confidence: number; // 0..1
}

export interface VisionRecognitionResult {
  items: RecognizedItem[];
  // ADVISORY ONLY: the authoritative count is always `items.length`.
  countVisible: number | null;
}

export interface VisionRecognitionInput {
  image: Buffer;
  mimeType: string;
}

export interface VisionProviderConfig {
  apiKey: string;
  model: string;
  // The OpenAI-compatible base URL (absolute, trailing-slash-normalized).
  // Always set by `VisionService`; optional only so the provider can defend
  // against a missing value.
  baseUrl?: string;
}

export interface VisionProvider {
  readonly id: VisionProviderId;
  readonly label: string;
  readonly defaultModel: string;
  recognize(
    input: VisionRecognitionInput,
    config: VisionProviderConfig,
  ): Promise<VisionRecognitionResult>;
}
```

`DEFAULT_PROVIDER_ID = 'custom'` is the provider used when the stored row
names no registered provider; `VISION_API_KEY_ENV_VAR = 'CUSTOM_API_KEY'` is
the env var the API key falls back to when no encrypted DB key is set.
`LLM_MODEL` or a stored setting overrides the model.

# Item JSON schema

The shared `VISION_INSTRUCTION_PROMPT` asks for a JSON **object** with an
`items` array and an advisory `count_visible` — never a bare count. It also
instructs the model to read the platform off the physical box, disc, cartridge,
or media banner and to report its canonical name, and never to infer the
platform from the game title or cover art. The
canonical strict JSON Schema (`VISION_RECOGNITION_SCHEMA`, which wraps
`VISION_RESPONSE_SCHEMA` as its `items`) is:

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "edition": { "type": ["string", "null"] },
          "platform": { "type": ["string", "null"] },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "required": ["title", "edition", "platform", "confidence"],
        "additionalProperties": false
      }
    },
    "count_visible": { "type": ["number", "null"] }
  },
  "required": ["items", "count_visible"],
  "additionalProperties": false
}
```

`count_visible` is **advisory only**: the number of recognized games is always
`items.length`. The parser (`parseAdvisoryCount`) never throws on a missing,
non-numeric, negative or non-finite value — it becomes `null` — so a bad count
can never abort recognition.

Obvious "no platform" sentinel strings — `N/A`, `NA`, `unknown`, `none`,
`null`, `not visible`, `unreadable`, `unclear` and the like, compared after the
same case/diacritic/punctuation/whitespace normalization as platform matching —
are normalized to `null` at parse time, so a sentinel can never become an
authoritative import platform. Real platform strings are preserved unchanged.

The **Custom** adapter uses `recognizeOpenAiCompatible` in
`settings/vision/openai-compatible.ts`: Structured Outputs requires a
JSON-_object_ root, so it sends `VISION_RECOGNITION_SCHEMA` directly as the
strict `json_schema` response format, posts to `{baseUrl}/chat/completions`
with an `Authorization: Bearer` header, and decodes
`choices[0].message.content`. It passes the parsed JSON through the shared
`parseVisionRecognition`, which validates each item (a missing/invalid item
list throws a safe `bad_response` error) and attaches the advisory count. The
legacy bare-array shape is still accepted, with `countVisible: null`.

# Prompt and raw output

The prompt requires a list of every distinct game (title, edition, platform,
confidence) and tells the model not to estimate how many games are in the photo.
Each provider logs its raw model text once at `Logger.debug` level, truncated by
`truncateForLog` (cap `RAW_VISION_LOG_LIMIT = 2000` chars); the raw text is
**never persisted** — no DB write and no addition to the job result.

Malformed output is a boundary concern: the parsers throw only
`VisionProviderError('bad_response', …)`. Ticket 3.5 catches any error from
`VisionService.recognize`, maps it with `photoImportFailureReason` (in
`apps/api/src/queue/photo-import.failure.ts`), and passes that safe string to
`ImportJobsService.markFailed`.

# Registry and facade

- `VisionProviderRegistry` holds a `Map<VisionProviderId, VisionProvider>`,
  populated from the injected `CustomVisionProvider`. `ids()`, `has(id)`, and
  `get(id)`; `get` throws `VisionProviderError('unknown_provider')` for an
  unregistered id.
- `VisionService` is the only surface the pipeline touches:
  - `recognize(input)` resolves the active config from
    [LLM Settings API](/llm-settings-api.md) and throws
    `VisionUnavailableError` when no key is available.
  - `test()` makes one real call with a 1x1 PNG and maps any failure to a
    stable code.

HTTP access goes through the abstract `VisionHttpClient` (`FetchVisionHttpClient`
uses global `fetch` + `AbortSignal.timeout`). It is the DI seam tests replace, so
the suite never contacts a real provider.

# Error codes

`VisionErrorCode`: `unknown_provider`, `unauthorized`, `model_not_found`,
`rate_limited`, `timeout`, `bad_response`, `network`, `server_error`. Messages
are fixed strings and never include the API key or the upstream response body.

# Adding a provider

1. Create `settings/vision/<name>-vision.provider.ts` implementing
   `VisionProvider`. If the backend speaks the OpenAI chat-completions
   protocol, delegate to `recognizeOpenAiCompatible`
   (`settings/vision/openai-compatible.ts`) and only supply the endpoint URL —
   that is all `custom` does. Otherwise reuse the prompt/schema helpers and
   build the request yourself.
2. Register it in `VisionProviderRegistry` with one `this.register(provider)`
   line (and add it to the constructor).
3. Add the class to `SettingsModule`'s `providers` array.
4. Wire its env-key fallback in `LlmSettingsService.resolveApiKey`.

No pipeline file changes.

# Out of scope

- The recognition pipeline itself is ticket 3.5 and now lives in
  [Photo Import Pipeline](/photo-import-pipeline.md).
- Non-OpenAI-compatible protocols (e.g. Anthropic-native), retry/backoff,
  rate limiting, caching, and real recognition accuracy.
