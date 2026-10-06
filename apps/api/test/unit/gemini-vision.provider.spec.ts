import { GeminiVisionProvider } from '../../src/settings/vision/gemini-vision.provider';
import {
  VisionHttpClient,
  type VisionHttpRequest,
  type VisionHttpResponse,
} from '../../src/settings/vision/vision-http.client';
import { VisionProviderError } from '../../src/settings/vision/vision.errors';
import type {
  VisionProviderConfig,
  VisionRecognitionInput,
} from '../../src/settings/vision/vision-provider';

function httpResponse(status: number, body: unknown): VisionHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  };
}

function geminiBody(items: unknown[]): unknown {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] } }],
  };
}

function createProvider(result: VisionHttpResponse | Error): {
  provider: GeminiVisionProvider;
  postJson: jest.Mock<Promise<VisionHttpResponse>, [VisionHttpRequest]>;
} {
  const postJson = jest.fn<Promise<VisionHttpResponse>, [VisionHttpRequest]>();
  if (result instanceof Error) {
    postJson.mockRejectedValue(result);
  } else {
    postJson.mockResolvedValue(result);
  }
  const http = { postJson } as unknown as VisionHttpClient;
  return { provider: new GeminiVisionProvider(http), postJson };
}

const input: VisionRecognitionInput = {
  image: Buffer.from([1, 2, 3, 4]),
  mimeType: 'image/png',
};
const config: VisionProviderConfig = {
  apiKey: 'gemini-secret',
  model: 'gemini-3.8-flash',
};

describe('GeminiVisionProvider (unit)', () => {
  it('exposes its id, label and default model', () => {
    const { provider } = createProvider(httpResponse(200, geminiBody([])));

    expect(provider.id).toBe('gemini');
    expect(provider.defaultModel).toBe('gemini-3.8-flash');
  });

  it('posts to the model endpoint with the key in x-goog-api-key', async () => {
    const { provider, postJson } = createProvider(
      httpResponse(200, geminiBody([])),
    );

    await provider.recognize(input, config);

    const request = postJson.mock.calls[0]?.[0];
    expect(request?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(request?.headers['x-goog-api-key']).toBe('gemini-secret');
    const body = request?.body as {
      contents: {
        parts: {
          text?: string;
          inline_data?: { mime_type: string; data: string };
        }[];
      }[];
      generationConfig: {
        responseMimeType: string;
        responseSchema: {
          type: string;
          items: {
            type: string;
            properties: Record<string, { type: string; nullable?: boolean }>;
            required: string[];
            propertyOrdering: string[];
          };
        };
      };
    };
    expect(body.contents[0]?.parts[1]?.inline_data).toEqual({
      mime_type: 'image/png',
      data: input.image.toString('base64'),
    });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    const schema = body.generationConfig.responseSchema;
    expect(schema.type).toBe('ARRAY');
    expect(schema.items.type).toBe('OBJECT');
    expect(schema.items.properties.title).toEqual({ type: 'STRING' });
    expect(schema.items.properties.edition).toEqual({
      type: 'STRING',
      nullable: true,
    });
    expect(schema.items.properties.platform).toEqual({
      type: 'STRING',
      nullable: true,
    });
    expect(schema.items.properties.confidence).toEqual({ type: 'NUMBER' });
    expect(schema.items.required).toEqual([
      'title',
      'edition',
      'platform',
      'confidence',
    ]);
    expect(schema.items.propertyOrdering).toEqual([
      'title',
      'edition',
      'platform',
      'confidence',
    ]);
  });

  it('parses recognized items from the candidate text', async () => {
    const { provider } = createProvider(
      httpResponse(
        200,
        geminiBody([
          {
            title: 'Hollow Knight',
            edition: null,
            platform: 'PS5',
            confidence: 0.9,
          },
          {
            title: 'Celeste',
            edition: 'Deluxe',
            platform: null,
            confidence: 1.4,
          },
        ]),
      ),
    );

    await expect(provider.recognize(input, config)).resolves.toEqual([
      {
        title: 'Hollow Knight',
        edition: null,
        platform: 'PS5',
        confidence: 0.9,
      },
      { title: 'Celeste', edition: 'Deluxe', platform: null, confidence: 1 },
    ]);
  });

  it('accepts an empty array', async () => {
    const { provider } = createProvider(httpResponse(200, geminiBody([])));

    await expect(provider.recognize(input, config)).resolves.toEqual([]);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'model_not_found'],
    [429, 'rate_limited'],
    [500, 'server_error'],
    [400, 'bad_response'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const { provider } = createProvider(httpResponse(status, { error: 'x' }));

    await expect(provider.recognize(input, config)).rejects.toMatchObject({
      code,
    });
  });

  it('maps a malformed JSON body to bad_response', async () => {
    const { provider } = createProvider(
      httpResponse(200, {
        candidates: [{ content: { parts: [{ text: 'not json' }] } }],
      }),
    );

    await expect(provider.recognize(input, config)).rejects.toBeInstanceOf(
      VisionProviderError,
    );
    await expect(provider.recognize(input, config)).rejects.toMatchObject({
      code: 'bad_response',
    });
  });

  it('maps a missing candidate to bad_response', async () => {
    const { provider } = createProvider(httpResponse(200, { candidates: [] }));

    await expect(provider.recognize(input, config)).rejects.toMatchObject({
      code: 'bad_response',
    });
  });

  it('maps an invalid item to bad_response', async () => {
    const { provider } = createProvider(
      httpResponse(200, geminiBody([{ title: '', confidence: 0.5 }])),
    );

    await expect(provider.recognize(input, config)).rejects.toMatchObject({
      code: 'bad_response',
    });
  });

  it('propagates transport errors from the http client', async () => {
    const { provider } = createProvider(
      new VisionProviderError('timeout', 'timed out'),
    );

    await expect(provider.recognize(input, config)).rejects.toMatchObject({
      code: 'timeout',
    });
  });
});
