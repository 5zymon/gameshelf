---
type: Feature
title: Vision Provider Abstraction
description: One VisionProvider interface with swappable Gemini/OpenAI backends behind a registry and a VisionService seam.
tags: [import, llm, architecture]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-06T00:00:00Z }
---

# Overview

Photo recognition must not hard-code a model vendor. This feature defines one
`VisionProvider` interface, one registry, and one `VisionService` facade. The
import pipeline (ticket 3.5 and later) will depend only on `VisionService`, so
the concrete backend and its model/key can change at runtime (through the
[LLM Settings API](/llm-settings-api.md)) or be swapped in code without touching
the pipeline.

Two backends ship: **Gemini** (default, `gemini-3.8-flash`) and **OpenAI**
(`gpt-4o-mini`). Both use the same instruction prompt and item shape; only the
request/response envelope differs.

# Interface

`apps/api/src/settings/vision/vision-provider.ts`:

```ts
export const SUPPORTED_PROVIDER_IDS = ['gemini', 'openai'] as const;
export type VisionProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];

export interface RecognizedItem {
  title: string;
  edition: string | null;
  platform: string | null;
  confidence: number; // 0..1
}

export interface VisionRecognitionInput {
  image: Buffer;
  mimeType: string;
}

export interface VisionProviderConfig {
  apiKey: string;
  model: string;
}

export interface VisionProvider {
  readonly id: VisionProviderId;
  readonly label: string;
  readonly defaultModel: string;
  recognize(
    input: VisionRecognitionInput,
    config: VisionProviderConfig,
  ): Promise<RecognizedItem[]>;
}
```

`DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'` and
`DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'` are exported defaults; `LLM_MODEL` or a
stored setting overrides them.

# Item JSON schema

The shared `VISION_INSTRUCTION_PROMPT` asks for a JSON array of items. The
canonical strict JSON Schema (`VISION_RESPONSE_SCHEMA`) is:

```json
{
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
}
```

Each provider adapts it to its API:

- **OpenAI** Structured Outputs requires a JSON-_object_ root, so it wraps the
  array under an `items` property and sends
  `{ "type": "object", "properties": { "items": <schema above> }, "required": ["items"], "additionalProperties": false }`
  as the strict `json_schema` response format. `parseRecognizedItems` accepts
  both the bare array and the `{ "items": [...] }` wrapper.
- **Gemini** passes the array schema directly as `responseSchema`, using the
  OpenAPI subset: uppercase types and `nullable: true` in place of
  `type: ["string", "null"]`, plus `propertyOrdering`.

Both providers decode their envelope (Gemini `candidates[0].content.parts[0].text`,
OpenAI `choices[0].message.content`) and pass the parsed JSON through the shared
`parseRecognizedItems`, which validates each item and throws a safe
`bad_response` error otherwise.

# Registry and facade

- `VisionProviderRegistry` holds a `Map<VisionProviderId, VisionProvider>`,
  populated from the injected concrete providers. `ids()`, `has(id)`, and
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
   `VisionProvider` (reuse the prompt/schema helpers).
2. Register it in `VisionProviderRegistry` with one `this.register(provider)`
   line (and add it to the constructor).
3. Add the class to `SettingsModule`'s `providers` array.

No pipeline file changes. If the provider id follows the existing convention,
its env fallback (`<ID>_API_KEY`) and settings enum are derived automatically.

# Out of scope

- The recognition pipeline itself (ticket 3.5) — `PhotoImportHandler` stays a
  placeholder.
- Anthropic/other providers, retry/backoff, rate limiting, caching, and real
  recognition accuracy.
