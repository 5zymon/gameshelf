import { VisionProviderError } from './vision.errors';

/**
 * The single backend GameShelf ships with: `custom`, any OpenAI-compatible
 * chat-completions endpoint (base URL + model + key). The pipeline never names
 * a concrete provider — it goes through `VisionService` and the
 * `VisionProviderRegistry`, so adding another one is one new class, one
 * registry line, and one module provider line.
 */
export const SUPPORTED_PROVIDER_IDS = ['custom'] as const;
export type VisionProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];

/** The provider used when the stored row names no registered provider. */
export const DEFAULT_PROVIDER_ID: VisionProviderId = 'custom';

/**
 * Hard ceiling on one provider HTTP call. 120 s (was 30 s) leaves room for a
 * self-hosted gateway (e.g. LiteLLM) that can take longer than 30 s on a
 * vision request; `IMPORT_JOB_TIMEOUT_MS` is sized to leave room for it.
 */
export const VISION_REQUEST_TIMEOUT_MS = 120_000;

/** The env var the API key falls back to when no encrypted DB key is set. */
export const VISION_API_KEY_ENV_VAR = 'CUSTOM_API_KEY';

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
  /**
   * The OpenAI-compatible base URL (absolute, trailing-slash-normalized).
   * Always set by `VisionService`; optional only so the provider can defend
   * against a missing value.
   */
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
  'instead. Read each title off its box; when the title text is unreadable, ' +
  'use your knowledge of the cover art to identify the game. For "platform", ' +
  'read the platform printed on the physical box, disc, cartridge or media ' +
  'banner (e.g. "PC DVD ROM", "PC", "Nintendo Switch", "PlayStation 5", ' +
  '"Xbox One", "PlayStation 4"), and give its canonical platform name (for ' +
  'example, a "PC DVD ROM" banner means the platform is "PC"). Never infer ' +
  'the platform from the game title, the cover art, or your prior knowledge ' +
  'of which platforms the game was released on — report only the platform ' +
  'you can actually read on the item; use null when no platform is visible. ' +
  'Return a JSON object with: "items", one object per game with "title" (the ' +
  'title as printed, required), "edition" (e.g. "GOTY Edition", or null), ' +
  '"platform" (the canonical platform read from the box, or null) and ' +
  '"confidence" (a number from 0 to 1); and "count_visible", the number of ' +
  'games you listed, or null if unsure. "count_visible" is advisory only and ' +
  'must match the number of items. Only include actual video games; if none ' +
  'are visible, return an empty "items" array and "count_visible": 0.';

/**
 * Canonical strict JSON Schema for the `items` value of the full recognition
 * response; `VISION_RECOGNITION_SCHEMA` adds the advisory count sibling.
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
 * array plus the advisory `count_visible`. Sent directly as the strict
 * `json_schema` response format by `recognizeOpenAiCompatible`.
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
 * Non-platform strings a vision model may return for "no platform visible".
 * Compared after lowercasing, stripping diacritics, and reducing any run of
 * non-alphanumeric characters to a single space, so "N/A", "N.A." and "n a"
 * all collapse to the same key. Such values are treated as absent (null) so
 * they never become an authoritative import platform.
 */
const NON_PLATFORM_SENTINEL_KEYS = new Set([
  'n a',
  'na',
  'none',
  'null',
  'unknown',
  'not visible',
  'not readable',
  'unreadable',
  'unclear',
  'unspecified',
]);

/**
 * Sentinel key for a model-reported platform string. Mirrors
 * `normalizePlatformName` (NFKD, strip diacritics, lowercase, `&` → " and ",
 * non-alphanumeric → a single space, trim, collapse) so the two agree on what
 * counts as a blank or sentinel value.
 */
export function platformSentinelKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normalizes a model-reported platform: blank/whitespace and obvious
 * "no platform" sentinels ("N/A", "unknown", "none", …) become `null`, so
 * downstream resolution falls back to the catalog candidate instead of
 * creating a junk platform from the sentinel. Real values are returned
 * trimmed and unchanged.
 */
function parsePlatformValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  const key = platformSentinelKey(trimmed);
  if (key === '' || NON_PLATFORM_SENTINEL_KEYS.has(key)) {
    return null;
  }
  return trimmed;
}

/**
 * Validates the model's decoded JSON into `RecognizedItem[]`. Every provider
 * shares this so a malformed payload always surfaces as `bad_response` rather
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
      platform: parsePlatformValue(platform),
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
