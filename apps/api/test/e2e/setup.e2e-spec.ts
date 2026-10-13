import type { Server } from 'node:http';
import request from 'supertest';
import { SETUP_COMPLETED_MESSAGE } from '../../src/auth/users.service';
import { UUID_V7_PATTERN } from '../helpers/ids';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';

interface ErrorBody {
  statusCode: number;
  message: string;
  error: string;
}

interface SetupBody {
  user: { id: string; email: string; createdAt: string };
}

describe('First-run setup API (e2e)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
  });

  afterAll(async () => {
    await test.app.close();
  });

  function server(): Server {
    return test.app.getHttpServer() as Server;
  }

  it('reports setup required on an empty users table', async () => {
    const res = await request(server()).get('/setup/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ setupRequired: true });
  });

  it('creates the first account and reports setup complete', async () => {
    const res = await request(server()).post('/setup').send({
      email: '  Player@Example.COM ',
      password: 'correct horse battery staple',
    });

    expect(res.status).toBe(201);
    const body = res.body as SetupBody;
    expect(body.user.email).toBe('player@example.com');
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.user.id).toMatch(UUID_V7_PATTERN);
    await expect(test.prisma.user.count()).resolves.toBe(1);

    const status = await request(server()).get('/setup/status');
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ setupRequired: false });
  });

  it('the created account can log in', async () => {
    const setup = await request(server()).post('/setup').send({
      email: 'player@example.com',
      password: 'correct horse battery staple',
    });
    expect(setup.status).toBe(201);

    const login = await request(server()).post('/auth/login').send({
      email: 'player@example.com',
      password: 'correct horse battery staple',
    });

    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ user: { email: 'player@example.com' } });
  });

  it('a second POST /setup returns 409 and creates nothing', async () => {
    const first = await request(server()).post('/setup').send({
      email: 'player@example.com',
      password: 'correct horse battery staple',
    });
    expect(first.status).toBe(201);

    const second = await request(server()).post('/setup').send({
      email: 'other@example.com',
      password: 'another password',
    });

    expect(second.status).toBe(409);
    expect((second.body as ErrorBody).message).toBe(SETUP_COMPLETED_MESSAGE);
    await expect(test.prisma.user.count()).resolves.toBe(1);
    await expect(
      test.prisma.user.findUnique({ where: { email: 'player@example.com' } }),
    ).resolves.not.toBeNull();
    await expect(
      test.prisma.user.findUnique({ where: { email: 'other@example.com' } }),
    ).resolves.toBeNull();
  });

  it('two concurrent POST /setup create exactly one user with a UUIDv7 id', async () => {
    const [a, b] = await Promise.all([
      request(server()).post('/setup').send({
        email: 'racer-a@example.com',
        password: 'correct horse battery staple',
      }),
      request(server()).post('/setup').send({
        email: 'racer-b@example.com',
        password: 'correct horse battery staple',
      }),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);
    await expect(test.prisma.user.count()).resolves.toBe(1);

    const created = a.status === 201 ? a : b;
    expect((created.body as SetupBody).user.id).toMatch(UUID_V7_PATTERN);
    const user = await test.prisma.user.findFirstOrThrow();
    expect(user.id).toMatch(UUID_V7_PATTERN);
  });

  it('rejects invalid payloads with 400', async () => {
    const cases: object[] = [
      {},
      { email: 123, password: 'correct horse battery staple' },
      { email: 'player@example.com' },
      { email: 'player@example.com', password: 123 },
      {
        email: `${'a'.repeat(256)}@example.com`,
        password: 'correct horse battery staple',
      },
      { email: 'player@example.com', password: 'x'.repeat(1025) },
    ];

    for (const body of cases) {
      const res = await request(server()).post('/setup').send(body);
      expect(res.status).toBe(400);
    }
    await expect(test.prisma.user.count()).resolves.toBe(0);
  });

  it('rejects an unknown field with 400 and creates nothing', async () => {
    const res = await request(server()).post('/setup').send({
      email: 'player@example.com',
      password: 'correct horse battery staple',
      isAdmin: true,
    });

    expect(res.status).toBe(400);
    await expect(test.prisma.user.count()).resolves.toBe(0);
  });

  it('rejects a blank email with 400 on an empty table', async () => {
    const res = await request(server()).post('/setup').send({
      email: '   ',
      password: 'correct horse battery staple',
    });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).message).toBe('email must not be blank');
    await expect(test.prisma.user.count()).resolves.toBe(0);
  });
});
