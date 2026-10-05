import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';

/**
 * Paths a scaffolded "sign up" would plausibly occupy. None may be routed:
 * public self-registration is deliberately disabled (see README, "Accounts and
 * registration"). User creation is reachable only through the one-time
 * `POST /setup` and the operator CLI.
 */
const FORBIDDEN_SIGNUP_PATHS = [
  '/auth/register',
  '/auth/signup',
  '/auth/sign-up',
  '/register',
  '/signup',
  '/users',
] as const;

describe('No self-registration (e2e)', () => {
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

  it('returns 404 for signup paths and creates no user', async () => {
    for (const path of FORBIDDEN_SIGNUP_PATHS) {
      const res = await request(server()).post(path).send({
        email: 'intruder@example.com',
        password: 'correct horse battery staple',
      });

      // 404 (not 401) proves no handler is mounted: the global SessionGuard is
      // bound per matched route, so an unknown path is rejected by the router
      // before any guard runs.
      expect(res.status).toBe(404);
    }

    await expect(test.prisma.user.count()).resolves.toBe(0);
  });
});
