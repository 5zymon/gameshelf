import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import request from 'supertest';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';
import { seedPlatform } from '../helpers/seed';

const QA_EMAIL = 'qa@gameshelf.local';
const QA_PASSWORD = 'gameshelf-qa-password';

describe('db:seed CLI (e2e, subprocess)', () => {
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

  function spawnSeed(
    nodeEnv: string,
    extraArgs: string[] = [],
  ): SpawnSyncReturns<string> {
    return spawnSync('npm', ['run', 'db:seed', '--', ...extraArgs], {
      cwd: resolve(__dirname, '..', '..'),
      env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: nodeEnv },
      encoding: 'utf8',
    });
  }

  async function qaLoginStatus(): Promise<number> {
    const res = await request(test.app.getHttpServer() as Server)
      .post('/auth/login')
      .send({ email: QA_EMAIL, password: QA_PASSWORD });
    return res.status;
  }

  it('refuses outside development without touching any row', async () => {
    const result = spawnSeed('test');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NODE_ENV=development');
    await expect(test.prisma.user.count()).resolves.toBe(0);
    await expect(test.prisma.game.count()).resolves.toBe(0);
    await expect(test.prisma.platform.count()).resolves.toBe(0);
  });

  it('seeds the QA account, three platforms and six games in development', async () => {
    const result = spawnSeed('development');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`QA account: ${QA_EMAIL}`);
    await expect(test.prisma.user.count()).resolves.toBe(1);
    await expect(test.prisma.platform.count()).resolves.toBe(3);
    await expect(test.prisma.game.count()).resolves.toBe(6);
    await expect(qaLoginStatus()).resolves.toBe(200);
  });

  it('is idempotent: a second run creates nothing and resets the password', async () => {
    const first = spawnSeed('development');
    expect(first.status).toBe(0);

    // Corrupt the stored hash so the second run must actually reset it.
    await test.prisma.user.update({
      where: { email: QA_EMAIL },
      data: { passwordHash: 'stale-hash' },
    });

    const second = spawnSeed('development');

    expect(second.status).toBe(0);
    expect(second.stdout).toContain(
      'user=updated platformsCreated=0 platformsReused=3 gamesCreated=0 gamesSkipped=6',
    );
    await expect(test.prisma.user.count()).resolves.toBe(1);
    await expect(test.prisma.platform.count()).resolves.toBe(3);
    await expect(test.prisma.game.count()).resolves.toBe(6);
    await expect(qaLoginStatus()).resolves.toBe(200);
  }, 90_000);

  it('reuses a pre-existing platform row by name', async () => {
    const ps5 = await seedPlatform(test.prisma, {
      name: 'PlayStation 5',
      slug: 'ps5',
      igdbId: 167,
    });

    const result = spawnSeed('development');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('platformsCreated=2 platformsReused=1');
    await expect(test.prisma.platform.count()).resolves.toBe(3);
    // The two PS5 seed games landed on the pre-seeded row.
    await expect(
      test.prisma.game.count({ where: { platformId: ps5.id } }),
    ).resolves.toBe(2);
  });

  it('prints usage and exits 1 on an unknown argument', () => {
    const result = spawnSeed('development', ['--foo']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: npm run db:seed');
  });
});
