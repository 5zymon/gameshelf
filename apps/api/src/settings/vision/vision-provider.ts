import { VisionProviderError } from './vision.errors';

/**
 * The three backends GameShelf ships with. The upload/recognition pipeline
 * never names a concrete provider — it goes through `VisionService` and the
 * `VisionProviderRegistry`, so adding a fourth provider needs one new class,
 * one registry line, and one module provider line only. `custom` reuses the
 * shared OpenAI-compatible builder (`openai-compatible.ts`), so it is one new
 * class plus the same two lines.
 */
export const SUPPORTED_PROVIDER_IDS = ['gemini', 'openai', 'custom'] as const;
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

/** Full recognition output: the item list plus the model's own (advisory) count. */
export interface VisionRecognitionResult {
  items: RecognizedItem[];
  /**
   * The model's self-reported number of visible games. ADVISORY ONLY: the
   * number of recognized games is always `items.length`; this value is never
   * used as the authoritative count. `null` when the model omitted a usable
   * number.
   */
  countVisible: number | null;
}

export interface VisionRecognitionInput {
  image: Buffer;
  mimeType: string;
}

export interface VisionProviderConfig {
  apiKey: string;
  model: string;
  /** The `custom` provider's base URL (absolute, trailing-slash-normalized). Only set for `custom`. */
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

/** Shared instruction text; each provider passes it in its own request shape. */
export const VISION_INSTRUCTION_PROMPT =
  'You read photos of physical video-game shelves. List EVERY distinct video ' +
  'game you can see (spines, covers, boxes). Never guess or estimate how many ' +
  'games are in the photo — counting objects is unreliable, so return the list ' +
  'instead. Read each title off its box; when the text is unreadable, use your ' +
  'knowledge of the cover art to identify the game. Return a JSON object with: ' +
  '"items", one object per game with "title" (the title as printed, required), ' +
  '"edition" (e.g. "GOTY Edition", or null), "platform" (e.g. "PlayStation 5", ' +
  'or null) and "confidence" (a number from 0 to 1); and "count_visible", the ' +
  'number of games you listed, or null if unsure. "count_visible" is advisory ' +
  'only and must match the number of items. Only include actual video games; ' +
  'if none are visible, return an empty "items" array and "count_visible": 0.';

/**
 * Canonical strict JSON Schema for the `items` value of the full recognition
 * response. Gemini adapts it to the OpenAPI subset with `nullable` instead of
 * `type: [..., "null"]`; the full object schema (`VISION_RECOGNITION_SCHEMA`)
 * adds the advisory count sibling.
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

/**
 * Canonical strict JSON Schema for the full recognition response: the item
 * array plus the advisory `count_visible`. OpenAI uses it directly; Gemini
 * adapts it to the OpenAPI subset in `gemini-vision.provider.ts`.
 */
export const VISION_RECOGNITION_SCHEMA = {
  type: 'object',
  properties: {
    items: VISION_RESPONSE_SCHEMA,
    count_visible: { type: ['number', 'null'] },
  },
  required: ['items', 'count_visible'],
  additionalProperties: false,
} as const;

/** Narrows unknown JSON to a plain object (never an array). */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrows unknown JSON to an array whose elements stay `unknown` (not `any`). */
export function asUnknownArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? (value as unknown[]) : null;
}

/** Caps a raw model response before it is logged (debug only, never stored). */
export const RAW_VISION_LOG_LIMIT = 2000;

export function truncateForLog(
  text: string,
  limit: number = RAW_VISION_LOG_LIMIT,
): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}…[truncated ${String(text.length - limit)} chars]`;
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

/**
 * The model's advisory `count_visible`. Never throws: a missing, non-numeric,
 * negative or non-finite value becomes `null`, so a bad count can never abort
 * recognition.
 */
export function parseAdvisoryCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

/**
 * Full recognition parse: validates the item list (throwing `bad_response` for
 * a missing/invalid list) and attaches the advisory count. The number of
 * recognized games is `result.items.length`; `countVisible` is never trusted.
 */
export function parseVisionRecognition(raw: unknown): VisionRecognitionResult {
  return {
    items: parseRecognizedItems(raw),
    countVisible: isJsonRecord(raw)
      ? parseAdvisoryCount(raw.count_visible)
      : null,
  };
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
