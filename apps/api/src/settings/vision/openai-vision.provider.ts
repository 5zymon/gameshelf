import { Injectable, Logger } from '@nestjs/common';
import {
  VisionHttpClient,
  type VisionHttpResponse,
} from './vision-http.client';
import { VisionProviderError, visionErrorFromStatus } from './vision.errors';
import {
  DEFAULT_OPENAI_MODEL,
  VISION_INSTRUCTION_PROMPT,
  VISION_RECOGNITION_SCHEMA,
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

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

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

/** Pulls `choices[0].message.content` out of an unknown payload. */
function extractText(payload: unknown): string {
  const choices = isJsonRecord(payload) ? payload.choices : undefined;
  const choiceList = asUnknownArray(choices);
  if (choiceList === null) {
    throw new VisionProviderError('bad_response');
  }
  const first = choiceList[0];
  const message = isJsonRecord(first) ? first.message : undefined;
  const content = isJsonRecord(message) ? message.content : undefined;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new VisionProviderError(
      'bad_response',
      'The provider returned no text content',
    );
  }
  return content;
}

function dataUrl(input: VisionRecognitionInput): string {
  return `data:${input.mimeType};base64,${input.image.toString('base64')}`;
}

@Injectable()
export class OpenAiVisionProvider implements VisionProvider {
  readonly id = 'openai' as const;
  readonly label = 'OpenAI';
  readonly defaultModel = DEFAULT_OPENAI_MODEL;

  private readonly logger = new Logger(OpenAiVisionProvider.name);

  constructor(private readonly http: VisionHttpClient) {}

  async recognize(
    input: VisionRecognitionInput,
    config: VisionProviderConfig,
  ): Promise<VisionRecognitionResult> {
    const response = await this.http.postJson({
      url: OPENAI_ENDPOINT,
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: {
        model: config.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VISION_INSTRUCTION_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl(input) } },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'recognized_items',
            strict: true,
            schema: VISION_RECOGNITION_SCHEMA,
          },
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
      `OpenAI raw recognition response: ${truncateForLog(text)}`,
    );
    return parseVisionRecognition(parseJsonResponse(text));
  }
}
