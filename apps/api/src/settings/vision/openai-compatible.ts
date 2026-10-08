import {
  VisionHttpClient,
  type VisionHttpResponse,
} from './vision-http.client';
import { VisionProviderError, visionErrorFromStatus } from './vision.errors';
import {
  VISION_INSTRUCTION_PROMPT,
  VISION_RECOGNITION_SCHEMA,
  VISION_REQUEST_TIMEOUT_MS,
  asUnknownArray,
  isJsonRecord,
  parseJsonResponse,
  parseVisionRecognition,
  type VisionProviderConfig,
  type VisionRecognitionInput,
  type VisionRecognitionResult,
} from './vision-provider';

function dataUrl(input: VisionRecognitionInput): string {
  return `data:${input.mimeType};base64,${input.image.toString('base64')}`;
}

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

export interface OpenAiCompatibleOutcome {
  result: VisionRecognitionResult;
  /** The model's raw text, for the caller's debug log (never persisted). */
  rawText: string;
}

/**
 * One OpenAI-compatible chat-completion vision call + parse. Shared by the
 * built-in OpenAI provider and the `custom` provider; the ONLY differences
 * between them are the endpoint URL and the (free-text) model name.
 */
export async function recognizeOpenAiCompatible(
  http: VisionHttpClient,
  url: string,
  config: VisionProviderConfig,
  input: VisionRecognitionInput,
): Promise<OpenAiCompatibleOutcome> {
  const response = await http.postJson({
    url,
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
  return {
    result: parseVisionRecognition(parseJsonResponse(text)),
    rawText: text,
  };
}
