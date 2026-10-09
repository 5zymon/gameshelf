import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GeminiVisionProvider } from '../../src/settings/vision/gemini-vision.provider';
import { OpenAiVisionProvider } from '../../src/settings/vision/openai-vision.provider';
import {
  VisionHttpClient,
  type VisionHttpResponse,
} from '../../src/settings/vision/vision-http.client';
import { VisionProviderError } from '../../src/settings/vision/vision.errors';
import {
  parseJsonResponse,
  parseVisionRecognition,
  VISION_INSTRUCTION_PROMPT,
  type VisionProviderConfig,
  type VisionRecognitionInput,
} from '../../src/settings/vision/vision-provider';

function readFixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', 'fixtures', 'vision', name),
    'utf8',
  );
}

function httpResponse(body: unknown): VisionHttpResponse {
  return {
    status: 200,
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  };
}

function geminiEnvelope(content: string): unknown {
  return { candidates: [{ content: { parts: [{ text: content }] } }] };
}

function openAiEnvelope(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

function clientReturning(body: unknown): VisionHttpClient {
  return {
    postJson: jest.fn().mockResolvedValue(httpResponse(body)),
  };
}

const input: VisionRecognitionInput = {
  image: Buffer.from([1, 2, 3, 4]),
  mimeType: 'image/png',
};
const config: VisionProviderConfig = {
  apiKey: 'secret',
  model: 'test-model',
};

function parseFixture(name: string) {
  return parseVisionRecognition(parseJsonResponse(readFixture(name)));
}

describe('Vision recognition parsing (unit)', () => {
  it('parses a valid list with the advisory count', () => {
    const result = parseFixture('valid.txt');

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      title: 'Hollow Knight',
      edition: null,
      platform: 'Nintendo Switch',
      confidence: 0.92,
    });
    expect(result.items[1]).toEqual({
      title: 'Celeste',
      edition: 'Deluxe Edition',
      platform: 'PlayStation 4',
      confidence: 0.71,
    });
    expect(result.countVisible).toBe(2);
  });

  it('treats the item list as authoritative when the count disagrees', () => {
    const result = parseFixture('count-mismatch.txt');

    // Acceptance: the model count is advisory only.
    expect(result.items).toHaveLength(2);
    expect(result.countVisible).toBe(5);
  });

  it('accepts a legacy bare array with no advisory count', () => {
    const result = parseFixture('legacy-array.txt');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('Hades');
    expect(result.countVisible).toBeNull();
  });

  it('tolerates a missing count', () => {
    const result = parseFixture('missing-count.txt');

    expect(result.items).toHaveLength(1);
    expect(result.countVisible).toBeNull();
  });

  it('tolerates a non-numeric count without throwing', () => {
    const result = parseFixture('bad-count.txt');

    expect(result.items).toHaveLength(1);
    expect(result.countVisible).toBeNull();
  });

  it('parses an empty list with count zero', () => {
    const result = parseFixture('empty.txt');

    expect(result.items).toEqual([]);
    expect(result.countVisible).toBe(0);
  });

  it('rejects an item without a title as bad_response', () => {
    expect(() => parseFixture('invalid-item.txt')).toThrow(VisionProviderError);
    try {
      parseFixture('invalid-item.txt');
    } catch (error) {
      expect(error).toBeInstanceOf(VisionProviderError);
      expect((error as VisionProviderError).code).toBe('bad_response');
    }
  });

  it('maps malformed JSON to bad_response with a clear message', () => {
    expect(() => parseJsonResponse(readFixture('malformed.txt'))).toThrow(
      VisionProviderError,
    );
    try {
      parseJsonResponse(readFixture('malformed.txt'));
    } catch (error) {
      expect(error).toBeInstanceOf(VisionProviderError);
      expect((error as VisionProviderError).code).toBe('bad_response');
      expect((error as VisionProviderError).message).toBe(
        'The model returned malformed JSON',
      );
    }
  });

  it('trims titles and clamps confidence', () => {
    const parsed = parseVisionRecognition({
      items: [
        {
          title: '  Outer Wilds  ',
          edition: ' ',
          platform: '  PC ',
          confidence: 1.4,
        },
        {
          title: 'Inside',
          edition: null,
          platform: null,
          confidence: -0.5,
        },
      ],
      count_visible: 9,
    });

    expect(parsed.items[0]).toEqual({
      title: 'Outer Wilds',
      edition: '',
      platform: 'PC',
      confidence: 1,
    });
    expect(parsed.items[1]?.confidence).toBe(0);
    // count_visible never overrides items.length.
    expect(parsed.countVisible).toBe(9);
  });

  it.each(['N/A', 'NA', 'N.A.', 'unknown', 'None', 'not visible'])(
    'normalizes the "no platform" sentinel %p to null',
    (platform) => {
      const parsed = parseVisionRecognition({
        items: [{ title: 'Hades', edition: null, platform, confidence: 0.8 }],
        count_visible: 1,
      });

      expect(parsed.items[0]?.platform).toBeNull();
    },
  );

  it.each(['Nintendo Switch', 'PC DVD ROM', 'PC', 'PlayStation 5'])(
    'preserves the real platform %p',
    (platform) => {
      const parsed = parseVisionRecognition({
        items: [{ title: 'Hades', edition: null, platform, confidence: 0.8 }],
        count_visible: 1,
      });

      // "PC DVD ROM" is expanded to its canonical equivalent later, in
      // resolvePlatformId — the parser leaves it untouched.
      expect(parsed.items[0]?.platform).toBe(platform);
    },
  );

  it('rounds a fractional advisory count down to an integer', () => {
    expect(
      parseVisionRecognition({ items: [], count_visible: 2.9 }).countVisible,
    ).toBe(2);
  });

  it('ignores a negative advisory count', () => {
    expect(
      parseVisionRecognition({ items: [], count_visible: -1 }).countVisible,
    ).toBeNull();
  });
});

describe('VISION_INSTRUCTION_PROMPT (unit)', () => {
  it('reads the platform off the physical box and forbids inferring it', () => {
    expect(VISION_INSTRUCTION_PROMPT).toContain(
      'read the platform printed on the physical box',
    );
    expect(VISION_INSTRUCTION_PROMPT).toContain('canonical platform name');
    expect(VISION_INSTRUCTION_PROMPT).toContain('Never infer the platform');
    expect(VISION_INSTRUCTION_PROMPT).toContain('PC DVD ROM');
  });
});

describe.each([
  [
    'Gemini',
    () =>
      new GeminiVisionProvider(
        clientReturning(geminiEnvelope(readFixture('valid.txt'))),
      ),
  ],
  [
    'OpenAI',
    () =>
      new OpenAiVisionProvider(
        clientReturning(openAiEnvelope(readFixture('valid.txt'))),
      ),
  ],
] as const)('%s recognition integration', (_name, factory) => {
  it('resolves items plus the advisory count', async () => {
    const result = await factory().recognize(input, config);

    expect(result.items).toHaveLength(2);
    expect(result.countVisible).toBe(2);
  });
});

describe.each([
  [
    'Gemini',
    () =>
      new GeminiVisionProvider(
        clientReturning(geminiEnvelope(readFixture('malformed.txt'))),
      ),
  ],
  [
    'OpenAI',
    () =>
      new OpenAiVisionProvider(
        clientReturning(openAiEnvelope(readFixture('malformed.txt'))),
      ),
  ],
] as const)('%s malformed output', (_name, factory) => {
  it('rejects with bad_response', async () => {
    await expect(factory().recognize(input, config)).rejects.toMatchObject({
      code: 'bad_response',
    });
  });
});
