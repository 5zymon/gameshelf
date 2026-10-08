import type { Server } from 'node:http';
import request from 'supertest';
import { UsersService } from '../../src/auth/users.service';
import {
  createTestApp,
  TEST_USER_EMAIL,
  TEST_USER_PASSWORD,
  type TestApp,
} from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';

const BASE = '/settings/preferences';

describe('Preferences API (e2e)', () => {
  let test: TestApp;
  let users: UsersService;

  beforeAll(async () => {
    test = await createTestApp();
    users = test.app.get(UsersService);
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

  it('GET requires authentication (401)', async () => {
    const res = await request.agent(server()).get(BASE);
    expect(res.status).toBe(401);
  });

  it('GET returns the default language after login', async () => {
    await test.login();

    const res = await test.request.get(BASE).expect(200);
    expect(res.body).toEqual({ language: 'pl' });
  });

  it('PUT updates the language and rewrites the NEXT_LOCALE cookie', async () => {
    await test.login();

    const res = await test.request
      .put(BASE)
      .send({ language: 'en' })
      .expect(200);
    expect(res.body).toEqual({ language: 'en' });

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const locale = cookies.find((c) => c.startsWith('NEXT_LOCALE='));
    expect(locale).toBeDefined();
    expect(locale).toContain('NEXT_LOCALE=en');
    expect(locale).toContain('HttpOnly');
  });

  it('GET reflects the updated language', async () => {
    await test.login();
    await test.request.put(BASE).send({ language: 'en' }).expect(200);

    const res = await test.request.get(BASE).expect(200);
    expect(res.body).toEqual({ language: 'en' });
  });

  it('PUT rejects an unsupported language with 400', async () => {
    await test.login();

    await test.request.put(BASE).send({ language: 'xx' }).expect(400);
  });

  it('login sets NEXT_LOCALE from the stored language', async () => {
    // Create the account (language defaults to 'pl'), then flip the stored
    // language to 'en' so a fresh login must heal the cookie from the DB.
    await users.createUser({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    });
    await test.prisma.user.update({
      where: { email: TEST_USER_EMAIL },
      data: { language: 'en' },
    });

    const res = await request
      .agent(server())
      .post('/auth/login')
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });
    expect(res.status).toBe(200);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const locale = cookies.find((c) => c.startsWith('NEXT_LOCALE='));
    expect(locale).toBeDefined();
    expect(locale).toContain('NEXT_LOCALE=en');
  });

  it('logout clears the NEXT_LOCALE cookie', async () => {
    await test.login();

    const res = await test.request.post('/auth/logout').expect(204);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const locale = cookies.find((c) => c.startsWith('NEXT_LOCALE='));
    expect(locale).toBeDefined();
    // A cleared cookie carries a past expiry (Express uses the epoch) or
    // Max-Age=0 — either way the browser drops it.
    expect(locale).toMatch(/Max-Age=0|Expires=\w+, 01 Jan 1970/);
  });
});
