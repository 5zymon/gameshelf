import type { Server } from 'node:http';
import { rmSync } from 'node:fs';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { PHOTO_IMPORT_QUEUE } from '../../src/queue/queue.constants';
import { QueueControlService } from '../../src/queue/queue-control.service';
import { LlmSettingsService } from '../../src/settings/llm-settings.service';
import { LlmKeyCryptoService } from '../../src/settings/llm-key-crypto.service';
import {
  VisionHttpClient,
  type VisionHttpRequest,
  type VisionHttpResponse,
} from '../../src/settings/vision/vision-http.client';
import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { createNoopPhotoImportHandler } from '../helpers/noop-photo-handler';
import { resetDatabase } from '../helpers/reset';

const BASE = '/settings/llm';
const UPLOAD_URL = '/import/upload';

const SECRET_KEY = 'sk-e2e-secret-do-not-leak';

interface SettingsBody {
  provider: string;
  model: string;
  keyPresent: boolean;
  importEnabled: boolean;
  availableProviders: unknown[];
  updatedAt: string | null;
}

function geminiBody(items: unknown[]): VisionHttpResponse {
  return {
    status: 200,
    ok: true,
    json: () =>
      Promise.resolve({
        candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] } }],
      }),
    text: () => Promise.resolve(''),
  };
}

function failure(status: number): VisionHttpResponse {
  return {
    status,
    ok: false,
    json: () => Promise.resolve({ error: 'denied' }),
    text: () => Promise.resolve(''),
  };
}

describe('LLM settings API (e2e)', () => {
  let test: TestApp;
  let settings: LlmSettingsService;
  let queue: Queue;
  let postJson: jest.Mock<Promise<VisionHttpResponse>, [VisionHttpRequest]>;

  beforeAll(async () => {
    test = await createTestApp([
      {
        provide: PhotoImportHandler,
        useValue: createNoopPhotoImportHandler(),
      },
    ]);
    settings = test.app.get(LlmSettingsService);
    queue = test.app.get<Queue>(getQueueToken(PHOTO_IMPORT_QUEUE));
    const http = test.app.get(VisionHttpClient);
    postJson = jest.spyOn(http, 'postJson') as unknown as jest.Mock<
      Promise<VisionHttpResponse>,
      [VisionHttpRequest]
    >;
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    // A pause left by a failed test must never leak into the next one.
    await queue.resume();
    await test.login();
    postJson.mockReset();
  });

  afterAll(async () => {
    postJson.mockRestore();
    await test.app.close();
    // The upload test writes to the shared e2e temp photo dir; leave nothing.
    const dir = process.env.IMPORT_PHOTOS_DIR;
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('GET requires authentication (401)', async () => {
    const server = test.app.getHttpServer() as Server;
    await request.agent(server).get(BASE).expect(401);
  });

  it('GET returns the env-backed defaults without the key', async () => {
    const res = await test.request.get(BASE).expect(200);
    const body = res.body as SettingsBody;

    expect(body).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      keyPresent: true,
      importEnabled: true,
      updatedAt: null,
    });
    expect(body.availableProviders).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('test-llm-key');
  });

  it('PUT stores an encrypted key and never echoes it back', async () => {
    const res = await test.request
      .put(BASE)
      .send({ provider: 'openai', model: 'gpt-4o-mini', apiKey: SECRET_KEY })
      .expect(200);

    expect(res.body).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      keyPresent: true,
      importEnabled: true,
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET_KEY);

    const row = await test.prisma.llmSetting.findUnique({ where: { id: 1 } });
    expect(row?.provider).toBe('openai');
    expect(row?.apiKeyCiphertext).not.toBeNull();
    expect(row?.apiKeyCiphertext).not.toContain(SECRET_KEY);

    // The stored ciphertext is a real AES-256-GCM payload.
    expect(
      test.app.get(LlmKeyCryptoService).decrypt(row?.apiKeyCiphertext ?? ''),
    ).toBe(SECRET_KEY);

    const readBack = await test.request.get(BASE).expect(200);
    expect(JSON.stringify(readBack.body)).not.toContain(SECRET_KEY);
  });

  it('saving a key resumes a queue paused by an LLM config error', async () => {
    await test.app
      .get(QueueControlService)
      .pauseForConfig('llm', 'The provider rejected the API key');
    expect(await queue.isPaused()).toBe(true);

    await test.request
      .put(BASE)
      .send({ provider: 'gemini', apiKey: SECRET_KEY })
      .expect(200);

    expect(await queue.isPaused()).toBe(false);
    const state = await test.prisma.importQueueState.findUnique({
      where: { id: 1 },
    });
    expect(state).toMatchObject({ paused: false, source: null, reason: null });
  });

  it('PUT with a missing apiKey keeps the stored key', async () => {
    await test.request
      .put(BASE)
      .send({ provider: 'gemini', apiKey: SECRET_KEY })
      .expect(200);

    const res = await test.request
      .put(BASE)
      .send({ provider: 'gemini' })
      .expect(200);
    expect(res.body).toMatchObject({ provider: 'gemini', keyPresent: true });
  });

  it('PUT switching provider without a key does not reuse the stored key', async () => {
    await test.request
      .put(BASE)
      .send({ provider: 'gemini', model: 'gemini-x', apiKey: SECRET_KEY })
      .expect(200);

    const res = await test.request
      .put(BASE)
      .send({ provider: 'openai' })
      .expect(200);
    expect(res.body).toMatchObject({ provider: 'openai' });

    const row = await test.prisma.llmSetting.findUnique({ where: { id: 1 } });
    expect(row?.provider).toBe('openai');
    expect(row?.apiKeyCiphertext).toBeNull();
    expect(row?.model).toBeNull();

    // The old gemini secret must never be resolved for the new provider.
    const active = await settings.resolveActive();
    expect(active?.provider).toBe('openai');
    expect(active?.apiKey).not.toBe(SECRET_KEY);
    expect(JSON.stringify(res.body)).not.toContain(SECRET_KEY);
  });

  it('PUT with an empty apiKey clears the key', async () => {
    await test.request
      .put(BASE)
      .send({ provider: 'gemini', apiKey: SECRET_KEY })
      .expect(200);

    const res = await test.request
      .put(BASE)
      .send({ provider: 'gemini', apiKey: '' })
      .expect(200);
    // Clearing falls back to the (test) env key, so keyPresent stays true.
    const row = await test.prisma.llmSetting.findUnique({ where: { id: 1 } });
    expect(row?.apiKeyCiphertext).toBeNull();
    expect((res.body as SettingsBody).keyPresent).toBe(true);
  });

  it('PUT rejects an unknown provider with 400', async () => {
    await test.request.put(BASE).send({ provider: 'anthropic' }).expect(400);
  });

  it('PUT rejects a model over 128 chars with 400', async () => {
    await test.request
      .put(BASE)
      .send({ provider: 'gemini', model: 'x'.repeat(129) })
      .expect(400);
  });

  it('PUT rejects an unknown field with 400', async () => {
    await test.request
      .put(BASE)
      .send({ provider: 'gemini', bogus: true })
      .expect(400);
  });

  it('POST test returns ok on a successful provider call', async () => {
    postJson.mockResolvedValue(geminiBody([]));

    const res = await test.request.post(`${BASE}/test`).expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      code: 'ok',
      provider: 'gemini',
    });
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it('POST test returns a failure code with HTTP 200', async () => {
    postJson.mockResolvedValue(failure(401));

    const res = await test.request.post(`${BASE}/test`).expect(200);

    expect(res.body).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(JSON.stringify(res.body)).not.toContain(SECRET_KEY);
  });

  it('POST test reports not_configured when no key is available', async () => {
    const spy = jest.spyOn(settings, 'resolveActive').mockResolvedValue(null);
    try {
      const res = await test.request.post(`${BASE}/test`).expect(200);
      expect(res.body).toMatchObject({ ok: false, code: 'not_configured' });
    } finally {
      spy.mockRestore();
    }
  });

  it('POST test requires authentication (401)', async () => {
    const server = test.app.getHttpServer() as Server;
    await request.agent(server).post(`${BASE}/test`).expect(401);
  });

  it('import upload is refused with 503 when no key is configured', async () => {
    const spy = jest.spyOn(settings, 'isConfigured').mockResolvedValue(false);
    try {
      await test.request
        .post(UPLOAD_URL)
        .attach('files', Buffer.from('x'), {
          filename: 'x.png',
          contentType: 'image/png',
        })
        .expect(503);
      expect(await test.prisma.importJob.count()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('import upload succeeds (202) when a key is configured', async () => {
    const res = await test.request
      .post(UPLOAD_URL)
      .attach('files', Buffer.from('x'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(202);

    expect((res.body as { jobs: unknown[] }).jobs).toHaveLength(1);
  });
});
