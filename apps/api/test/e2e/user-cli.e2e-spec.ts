import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import request from 'supertest';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';

const EMAIL = 'cli-player@example.com';
const FIRST_PASSWORD = 'first-cli-secret';
const SECOND_PASSWORD = 'second-cli-secret';

describe('User CLI (e2e, subprocess)', () => {
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

  function spawnCli(args: string[], input: string): SpawnSyncReturns<string> {
    return spawnSync('npm', args, {
      cwd: resolve(__dirname, '..', '..'),
      env: { ...process.env, NODE_OPTIONS: '' },
      input,
      encoding: 'utf8',
    });
  }

  function runCli(
    sub: string,
    email: string,
    password: string,
  ): SpawnSyncReturns<string> {
    return spawnCli(['run', sub, '--', '--email', email], `${password}\n`);
  }

  async function login(password: string): Promise<number> {
    const res = await request(server())
      .post('/auth/login')
      .send({ email: EMAIL, password });
    return res.status;
  }

  it('user:create exits 0 and the account can log in', async () => {
    const result = runCli('user:create', EMAIL, FIRST_PASSWORD);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Created user');
    await expect(login(FIRST_PASSWORD)).resolves.toBe(200);
  });

  it('user:passwd exits 0 and swaps the password', async () => {
    expect(runCli('user:create', EMAIL, FIRST_PASSWORD).status).toBe(0);

    const result = runCli('user:passwd', EMAIL, SECOND_PASSWORD);
    expect(result.status).toBe(0);

    await expect(login(FIRST_PASSWORD)).resolves.toBe(401);
    await expect(login(SECOND_PASSWORD)).resolves.toBe(200);
  });

  it('user:passwd on an unknown email exits 1 with a readable message', () => {
    const result = runCli('user:passwd', EMAIL, SECOND_PASSWORD);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No user with email');
  });

  it('a duplicate user:create exits 1 with a readable message', () => {
    expect(runCli('user:create', EMAIL, FIRST_PASSWORD).status).toBe(0);

    const result = runCli('user:create', EMAIL, SECOND_PASSWORD);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('already exists');
  });

  it('user:create accepts --password non-interactively and the account can log in', async () => {
    const result = spawnCli(
      [
        'run',
        'user:create',
        '--',
        '--email',
        EMAIL,
        '--password',
        FIRST_PASSWORD,
      ],
      '',
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Created user');
    await expect(login(FIRST_PASSWORD)).resolves.toBe(200);
  });

  it('user:create without --email off a TTY exits 1', async () => {
    const result = spawnCli(['run', 'user:create', '--'], '');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--email is required');
    await expect(test.prisma.user.count()).resolves.toBe(0);
  });
});
