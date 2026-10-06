import { Injectable, Logger } from '@nestjs/common';
import {
  VisionHttpClient,
  type VisionHttpResponse,
} from './vision-http.client';
import { VisionProviderError, visionErrorFromStatus } from './vision.errors';
import {
  DEFAULT_GEMINI_MODEL,
  VISION_INSTRUCTION_PROMPT,
  VISION_REQUEST_TIMEOUT_MS,
  asUnknownArray,
  isJsonRecord,
  parseJsonResponse,
  parseVisionRecognition,
  truncateForLog,
  type VisionProvider,
  type VisionProviderConfig,
  type VisionRecognitionInput,
  type VisionRecognitionResult,
} from './vision-provider';

/**
 * Gemini's `responseSchema` is the OpenAPI subset: uppercase types and a
 * `nullable` flag instead of a JSON-Schema `type` union.
 */
const GEMINI_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    edition: { type: 'STRING', nullable: true },
    platform: { type: 'STRING', nullable: true },
    confidence: { type: 'NUMBER' },
  },
  required: ['title', 'edition', 'platform', 'confidence'],
  propertyOrdering: ['title', 'edition', 'platform', 'confidence'],
} as const;

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: { type: 'ARRAY', items: GEMINI_ITEM_SCHEMA },
    count_visible: { type: 'NUMBER', nullable: true },
  },
  required: ['items', 'count_visible'],
  propertyOrdering: ['items', 'count_visible'],
} as const;

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models';

async function readJson(response: VisionHttpResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new VisionProviderError(
      'bad_response',
      'The provider returned a non-JSON response',
    );
  }
}

/** Pulls `candidates[0].content.parts[0].text` out of an unknown payload. */
function extractText(payload: unknown): string {
  const candidates = isJsonRecord(payload) ? payload.candidates : undefined;
  const candidateList = asUnknownArray(candidates);
  if (candidateList === null) {
    throw new VisionProviderError('bad_response');
  }
  const first = candidateList[0];
  const content = isJsonRecord(first) ? first.content : undefined;
  const parts = asUnknownArray(
    isJsonRecord(content) ? content.parts : undefined,
  );
  if (parts === null) {
    throw new VisionProviderError('bad_response');
  }
  const firstPart = parts[0];
  const text = isJsonRecord(firstPart) ? firstPart.text : undefined;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new VisionProviderError(
      'bad_response',
      'The provider returned no text content',
    );
  }
  return text;
}

@Injectable()
export class GeminiVisionProvider implements VisionProvider {
  readonly id = 'gemini' as const;
  readonly label = 'Google Gemini';
  readonly defaultModel = DEFAULT_GEMINI_MODEL;

  private readonly logger = new Logger(GeminiVisionProvider.name);

  constructor(private readonly http: VisionHttpClient) {}

  async recognize(
    input: VisionRecognitionInput,
    config: VisionProviderConfig,
  ): Promise<VisionRecognitionResult> {
    const response = await this.http.postJson({
      url: `${GEMINI_ENDPOINT}/${encodeURIComponent(config.model)}:generateContent`,
      headers: { 'x-goog-api-key': config.apiKey },
      body: {
        contents: [
          {
            parts: [
              { text: VISION_INSTRUCTION_PROMPT },
              {
                inline_data: {
                  mime_type: input.mimeType,
                  data: input.image.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        },
      },
      timeoutMs: VISION_REQUEST_TIMEOUT_MS,
    });
    if (!response.ok) {
      throw visionErrorFromStatus(response.status);
    }
    const payload = await readJson(response);
    const text = extractText(payload);
    this.logger.debug(
      `Gemini raw recognition response: ${truncateForLog(text)}`,
    );
    return parseVisionRecognition(parseJsonResponse(text));
  }
}
