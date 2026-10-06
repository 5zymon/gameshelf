import type { INestApplication } from '@nestjs/common';
import {
  type IgdbHealth,
  IgdbClient,
} from '../../src/game-catalog/igdb.client';
import { createTestApp } from '../helpers/test-app';

/**
 * `GET /health/igdb` is unauthenticated and must never fail the request: an
 * unreachable IGDB is an `ok`-shaped 200 body with `status: "error"`. The
 * `IgdbClient` is overridden so the suite makes no network call.
 */
describe('GET /health/igdb (e2e)', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
      app = undefined;
    }
  });

  async function startWith(
    health: IgdbHealth,
  ): Promise<ReturnType<typeof createTestApp>> {
    const test = await createTestApp([
      {
        provide: IgdbClient,
        useValue: { checkHealth: jest.fn().mockResolvedValue(health) },
      },
    ]);
    app = test.app;
    return test;
  }

  it('returns the token status without authentication', async () => {
    const health: IgdbHealth = { status: 'ok', token: 'cached' };
    const test = await startWith(health);

    const res = await test.request.get('/health/igdb');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(health);
  });

  it('returns an error body as 200 and never fails the request', async () => {
    const health: IgdbHealth = {
      status: 'error',
      token: 'error',
      message: 'IGDB rejected the credentials',
    };
    const test = await startWith(health);

    const res = await test.request.get('/health/igdb');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(health);
  });
});
