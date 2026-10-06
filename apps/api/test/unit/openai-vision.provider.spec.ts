import { OpenAiVisionProvider } from '../../src/settings/vision/openai-vision.provider';
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

function openAiBody(content: unknown): unknown {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

function createProvider(result: VisionHttpResponse | Error): {
  provider: OpenAiVisionProvider;
  postJson: jest.Mock<Promise<VisionHttpResponse>, [VisionHttpRequest]>;
} {
  const postJson = jest.fn<Promise<VisionHttpResponse>, [VisionHttpRequest]>();
  if (result instanceof Error) {
    postJson.mockRejectedValue(result);
  } else {
    postJson.mockResolvedValue(result);
  }
  const http = { postJson } as unknown as VisionHttpClient;
  return { provider: new OpenAiVisionProvider(http), postJson };
}

const input: VisionRecognitionInput = {
  image: Buffer.from([9, 8, 7]),
  mimeType: 'image/jpeg',
};
const config: VisionProviderConfig = {
  apiKey: 'openai-secret',
  model: 'gpt-4o-mini',
};

describe('OpenAiVisionProvider (unit)', () => {
  it('exposes its id, label and default model', () => {
    const { provider } = createProvider(
      httpResponse(200, openAiBody({ items: [], count_visible: 0 })),
    );

    expect(provider.id).toBe('openai');
    expect(provider.defaultModel).toBe('gpt-4o-mini');
  });

  it('posts a chat completion with a bearer key and a data URL image', async () => {
    const { provider, postJson } = createProvider(
      httpResponse(200, openAiBody({ items: [], count_visible: 0 })),
    );

    await provider.recognize(input, config);

    const request = postJson.mock.calls[0]?.[0];
    expect(request?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(request?.headers.authorization).toBe('Bearer openai-secret');
    const body = request?.body as {
      model: string;
      messages: {
        content: { type: string; image_url?: { url: string } }[];
      }[];
      response_format: {
        type: string;
        json_schema: {
          strict: boolean;
          name: string;
          schema: {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
              items: {
                type: string;
                items: {
                  type: string;
                  additionalProperties: boolean;
                  required: string[];
                  properties: Record<string, unknown>;
                };
              };
              count_visible: { type: string[] };
            };
          };
        };
      };
    };
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0]?.content[1]?.image_url?.url).toBe(
      `data:image/jpeg;base64,${input.image.toString('base64')}`,
    );
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    // Structured Outputs requires an object root; the item array plus the
    // advisory count share that root.
    const schema = body.response_format.json_schema.schema;
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['items', 'count_visible']);
    expect(schema.properties.items.type).toBe('array');
    expect(schema.properties.count_visible).toEqual({
      type: ['number', 'null'],
    });
    const item = schema.properties.items.items;
    expect(item.type).toBe('object');
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual([
      'title',
      'edition',
      'platform',
      'confidence',
    ]);
    expect(Object.keys(item.properties)).toEqual([
      'title',
      'edition',
      'platform',
      'confidence',
    ]);
  });

  it('parses recognized items and the advisory count from the message content', async () => {
    const { provider } = createProvider(
      httpResponse(
        200,
        openAiBody({
          items: [
            {
              title: 'Hades',
              edition: null,
              platform: 'Nintendo Switch',
              confidence: 0.8,
            },
          ],
          count_visible: 1,
        }),
      ),
    );

    await expect(provider.recognize(input, config)).resolves.toEqual({
      items: [
        {
          title: 'Hades',
          edition: null,
          platform: 'Nintendo Switch',
          confidence: 0.8,
        },
      ],
      countVisible: 1,
    });
  });

  it.each([
    [401, 'unauthorized'],
    [404, 'model_not_found'],
    [429, 'rate_limited'],
    [503, 'server_error'],
    [422, 'bad_response'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const { provider } = createProvider(httpResponse(status, { error: 'x' }));

    await expect(provider.recognize(input, config)).rejects.toMatchObject({
      code,
    });
  });

  it('maps malformed content to bad_response', async () => {
    const { provider } = createProvider(
      httpResponse(200, { choices: [{ message: { content: '{' } }] }),
    );

    await expect(provider.recognize(input, config)).rejects.toMatchObject({
      code: 'bad_response',
    });
  });

  it('propagates transport errors from the http client', async () => {
    const { provider } = createProvider(
      new VisionProviderError('network', 'offline'),
    );

    await expect(provider.recognize(input, config)).rejects.toMatchObject({
      code: 'network',
    });
  });
});
