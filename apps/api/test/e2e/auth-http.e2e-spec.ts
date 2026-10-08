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

interface ErrorBody {
  statusCode: number;
  message: string;
  error: string;
}

describe('Auth HTTP API (e2e)', () => {
  let test: TestApp;
  let users: UsersService;

  beforeAll(async () => {
    test = await createTestApp();
    users = test.app.get(UsersService);
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    await users.createUser({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    });
  });

  afterAll(async () => {
    await test.app.close();
  });

  function server(): Server {
    return test.app.getHttpServer() as Server;
  }

  it('AC1/AC5: login sets an httpOnly, Lax, Path=/ cookie (not Secure by default)', async () => {
    const res = await test.request.post('/auth/login').send({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('user.passwordHash');

    // Login sets two cookies: the session token and the NEXT_LOCALE preference
    // (ticket 7.2). Locate the session cookie by name rather than by position.
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c) => c.startsWith('gameshelf_session='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure');
  });

  it('AC2: a protected endpoint returns 401 without a valid cookie', async () => {
    const fresh = request(server());

    const me = await fresh.get('/auth/me');
    expect(me.status).toBe(401);

    const logout = await fresh.post('/auth/logout');
    expect(logout.status).toBe(401);
  });

  it('AC7: unknown email and wrong password return the same generic 401', async () => {
    const unknown = await request(server())
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' });
    const wrong = await request(server())
      .post('/auth/login')
      .send({ email: TEST_USER_EMAIL, password: 'not-the-password' });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect((unknown.body as ErrorBody).message).toBe(
      'Invalid email or password',
    );
  });

  it('AC3: logout revokes the session server-side and clears the cookie', async () => {
    const login = await test.request.post('/auth/login').send({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    });
    expect(login.status).toBe(200);

    const before = await test.request.get('/auth/me');
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ email: TEST_USER_EMAIL });

    const logout = await test.request.post('/auth/logout');
    expect(logout.status).toBe(204);

    const after = await test.request.get('/auth/me');
    expect(after.status).toBe(401);
    await expect(test.prisma.session.count()).resolves.toBe(0);
  });

  it('AC4: an expired server-side session is rejected regardless of the cookie', async () => {
    await test.request.post('/auth/login').send({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    });
    await expect(test.prisma.session.count()).resolves.toBe(1);

    await test.prisma.session.updateMany({
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const me = await test.request.get('/auth/me');
    expect(me.status).toBe(401);
  });

  it('rejects invalid login payloads with 400', async () => {
    const cases: object[] = [
      {},
      { email: 123, password: TEST_USER_PASSWORD },
      { email: TEST_USER_EMAIL },
      { email: `${'a'.repeat(256)}@example.com`, password: TEST_USER_PASSWORD },
      { email: TEST_USER_EMAIL, password: 'x'.repeat(1025) },
    ];

    for (const body of cases) {
      const res = await request(server()).post('/auth/login').send(body);
      expect(res.status).toBe(400);
    }
  });

  // Keep this last: it swaps SESSION_COOKIE_SECURE before building a second app.
  describe('AC5: SESSION_COOKIE_SECURE=true', () => {
    let secureTest: TestApp;

    beforeAll(async () => {
      process.env.SESSION_COOKIE_SECURE = 'true';
      secureTest = await createTestApp();
    });

    afterAll(async () => {
      await secureTest.app.close();
      delete process.env.SESSION_COOKIE_SECURE;
    });

    it('adds the Secure flag to the session cookie', async () => {
      const res = await secureTest.request.post('/auth/login').send({
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
      });

      expect(res.status).toBe(200);
      const cookies = res.headers['set-cookie'] as unknown as string[];
      const sessionCookie = cookies.find((c) =>
        c.startsWith('gameshelf_session='),
      );
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain('Secure');
    });
  });
});
