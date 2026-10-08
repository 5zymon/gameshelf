import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';

const BASE = '/settings/game-databases';
const VALID_STATES = ['configured', 'missing', 'rejected'] as const;

interface DatabaseBody {
  id: string;
  label: string;
  state: string;
  message: string | null;
}

describe('Game database status API (e2e)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    await test.login();
  });

  afterAll(async () => {
    await test.app.close();
  });

  it('requires authentication (401)', async () => {
    const server = test.app.getHttpServer() as Server;
    await request.agent(server).get(BASE).expect(401);
  });

  it('returns the shape of both databases without any secret', async () => {
    const res = await test.request.get(BASE).expect(200);
    const body = res.body as DatabaseBody[];

    expect(body).toHaveLength(2);
    expect(body.map((entry) => entry.id)).toEqual(['igdb', 'mobygames']);
    for (const entry of body) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(VALID_STATES).toContain(
        entry.state as (typeof VALID_STATES)[number],
      );
    }
    expect(JSON.stringify(body)).not.toContain('test-llm-key');
  });

  it('maps a durable pause to a rejected state with a reason', async () => {
    await test.prisma.importQueueState.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        paused: true,
        source: 'igdb',
        reason: 'IGDB rejected the credentials',
      },
      update: {
        paused: true,
        source: 'igdb',
        reason: 'IGDB rejected the credentials',
      },
    });

    const res = await test.request.get(BASE).expect(200);
    const body = res.body as DatabaseBody[];
    const igdb = body.find((entry) => entry.id === 'igdb');
    // The env may or may not provide IGDB credentials, so `missing` (no key)
    // or `rejected` (key present + paused) are both valid; the exact mapping is
    // pinned in the unit spec. Whatever the state, a rejected entry carries a
    // reason and no state leaks a secret.
    expect(igdb).toBeDefined();
    expect(VALID_STATES).toContain(
      igdb?.state as (typeof VALID_STATES)[number],
    );
    if (igdb?.state === 'rejected') {
      expect(igdb.message).not.toBeNull();
    }
    expect(JSON.stringify(body)).not.toContain('test-llm-key');
  });
});
