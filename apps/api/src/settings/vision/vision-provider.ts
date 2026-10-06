import { VisionProviderError } from './vision.errors';

/**
 * The two backends GameShelf ships with. The upload/recognition pipeline never
 * names a concrete provider — it goes through `VisionService` and the
 * `VisionProviderRegistry`, so adding a third provider needs one new class, one
 * registry line, and one module provider line only.
 */
export const SUPPORTED_PROVIDER_IDS = ['gemini', 'openai'] as const;
export type VisionProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];

/** Default models; a runtime setting or `LLM_MODEL` overrides them. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

/** Hard ceiling on one provider HTTP call. */
export const VISION_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The env var a provider reads its key from when no encrypted DB key is set.
 * Derived from the provider id (`gemini` -> `GEMINI_API_KEY`), so a new
 * provider needs no extra mapping entry.
 */
export function providerApiKeyEnvVar(id: VisionProviderId): string {
  return `${id.toUpperCase()}_API_KEY`;
}

export interface RecognizedItem {
  title: string;
  edition: string | null;
  platform: string | null;
  /** 0..1 — how sure the model is this is a real, correctly identified game. */
  confidence: number;
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

/** Shared instruction text; each provider passes it in its own request shape. */
export const VISION_INSTRUCTION_PROMPT =
  'You read photos of physical video-game shelves. Identify every distinct ' +
  'video game visible (spines, covers, boxes). Return a JSON array with one ' +
  'object per game and these fields: "title" (the title as printed, required), ' +
  '"edition" (e.g. "GOTY Edition", or null), "platform" (e.g. "PlayStation 5", ' +
  'or null), and "confidence" (a number from 0 to 1). Only include actual ' +
  'video games; if none are visible, return an empty array.';

/**
 * Canonical strict JSON Schema for the array of recognized items. Gemini passes
 * it as-is (`GEMINI_RESPONSE_SCHEMA` adapts it to the OpenAPI subset with
 * `nullable` instead of `type: [..., "null"]`). OpenAI wraps it under an object
 * root because Structured Outputs only accept an object at the top level.
 */
export const VISION_RESPONSE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      edition: { type: ['string', 'null'] },
      platform: { type: ['string', 'null'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['title', 'edition', 'platform', 'confidence'],
    additionalProperties: false,
  },
} as const;

/** Narrows unknown JSON to a plain object (never an array). */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrows unknown JSON to an array whose elements stay `unknown` (not `any`). */
export function asUnknownArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? (value as unknown[]) : null;
}

/**
 * Validates the model's decoded JSON into `RecognizedItem[]`. Both providers
 * share this so a malformed payload always surfaces as `bad_response` rather
 * than a downstream crash.
 */
export function parseRecognizedItems(raw: unknown): RecognizedItem[] {
  const list =
    asUnknownArray(raw) ??
    (isJsonRecord(raw) ? asUnknownArray(raw.items) : null);
  if (list === null) {
    throw new VisionProviderError(
      'bad_response',
      'The model response was not a JSON array of items',
    );
  }
  return list.map((entry) => {
    if (!isJsonRecord(entry)) {
      throw new VisionProviderError(
        'bad_response',
        'The model returned a non-object item',
      );
    }
    const { title, edition, platform, confidence } = entry;
    if (typeof title !== 'string' || title.trim() === '') {
      throw new VisionProviderError(
        'bad_response',
        'The model returned an item without a title',
      );
    }
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
      throw new VisionProviderError(
        'bad_response',
        'The model returned an item without a numeric confidence',
      );
    }
    return {
      title: title.trim(),
      edition: typeof edition === 'string' ? edition.trim() : null,
      platform: typeof platform === 'string' ? platform.trim() : null,
      confidence: Math.min(1, Math.max(0, confidence)),
    };
  });
}

/** Parses the model's JSON text, mapping a syntax error to `bad_response`. */
export function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new VisionProviderError(
      'bad_response',
      'The model returned malformed JSON',
    );
  }
}
