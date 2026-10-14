import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';

/**
 * Paths a scaffolded "sign up" would plausibly occupy. None may be routed:
 * public self-registration is deliberately disabled (see
 * docs/features/references/installation.md, "Accounts and registration"). User
 * creation is reachable only through the one-time `POST /setup` and the
 * operator CLI.
 */
const FORBIDDEN_SIGNUP_PATHS = [
  '/auth/register',
  '/auth/signup',
  '/auth/sign-up',
  '/register',
  '/signup',
  '/users',
] as const;

/** A signup handler must not be mounted under any HTTP method. */
const FORBIDDEN_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

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

  it('returns 404 for signup paths on every HTTP method and creates no user', async () => {
    for (const path of FORBIDDEN_SIGNUP_PATHS) {
      for (const method of FORBIDDEN_METHODS) {
        const res = await request(server())[method](path).send({
          email: 'intruder@example.com',
          password: 'correct horse battery staple',
        });

        // 404 (not 401) proves no handler is mounted for this method: the
        // global SessionGuard only runs for a matched route, so an unknown
        // path is rejected by the router before any guard runs.
        expect(res.status).toBe(404);
      }
    }

    await expect(test.prisma.user.count()).resolves.toBe(0);
  });
});
