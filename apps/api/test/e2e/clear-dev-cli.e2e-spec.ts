import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import request from 'supertest';
import {
  createTestApp,
  TEST_USER_EMAIL,
  TEST_USER_PASSWORD,
  type TestApp,
} from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';
import { seedGame, seedPlatform } from '../helpers/seed';

const CANONICAL_NAME = 'PC (Microsoft Windows)';

describe('db:clear-dev CLI (e2e, subprocess)', () => {
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

  function spawnClearDev(
    nodeEnv: string,
    extraArgs: string[] = [],
    input = '',
  ): SpawnSyncReturns<string> {
    return spawnSync('npm', ['run', 'db:clear-dev', '--', ...extraArgs], {
      cwd: resolve(__dirname, '..', '..'),
      env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: nodeEnv },
      input,
      encoding: 'utf8',
    });
  }

  /** One game with media and import history, plus an import-created platform. */
  async function seedDevData(): Promise<void> {
    const canonical = await seedPlatform(test.prisma, {
      name: CANONICAL_NAME,
      slug: 'pc-microsoft-windows',
      igdbId: 6,
    });
    await seedPlatform(test.prisma, {
      name: 'Weird Box',
      slug: 'weird-box',
      addedByImport: true,
    });
    const game = await seedGame(test.prisma, {
      title: 'Hades',
      platformId: canonical.id,
    });
    await test.prisma.gameImage.create({
      data: { gameId: game.id, position: 0, url: '/api/covers/hades.webp' },
    });
    await test.prisma.gameVideo.create({
      data: { gameId: game.id, position: 0, videoId: 'dQw4w9WgXcQ' },
    });
    const job = await test.prisma.importJob.create({
      data: { status: 'done' },
    });
    await test.prisma.recognizedItem.create({
      data: {
        importJobId: job.id,
        position: 0,
        rawTitle: 'Hades',
        confidence: 0.9,
        status: 'imported',
        gameId: game.id,
      },
    });
    await test.prisma.unrecognizedItem.create({
      data: { importJobId: job.id, rawTitle: 'Mystery' },
    });
    await test.prisma.llmSetting.create({
      data: { provider: 'custom', baseUrl: 'http://localhost:11434/v1' },
    });
  }

  async function loginStatus(): Promise<number> {
    const res = await request(test.app.getHttpServer() as Server)
      .post('/auth/login')
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });
    return res.status;
  }

  it('refuses outside development without touching any row', async () => {
    await seedDevData();

    const result = spawnClearDev('test', ['--force']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NODE_ENV=development');
    await expect(test.prisma.game.count()).resolves.toBe(1);
    await expect(test.prisma.importJob.count()).resolves.toBe(1);
    await expect(test.prisma.platform.count()).resolves.toBe(2);
  });

  it('refuses in development without a terminal or --force', async () => {
    await seedDevData();

    const result = spawnClearDev('development');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to clear without a terminal');
    await expect(test.prisma.game.count()).resolves.toBe(1);
    await expect(test.prisma.platform.count()).resolves.toBe(2);
  });

  it('clears game and import data with --force and keeps accounts', async () => {
    await seedDevData();

    const result = spawnClearDev('development', ['--force']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Dev data cleared:');
    await expect(test.prisma.game.count()).resolves.toBe(0);
    await expect(test.prisma.gameImage.count()).resolves.toBe(0);
    await expect(test.prisma.gameVideo.count()).resolves.toBe(0);
    await expect(test.prisma.importJob.count()).resolves.toBe(0);
    await expect(test.prisma.recognizedItem.count()).resolves.toBe(0);
    await expect(test.prisma.unrecognizedItem.count()).resolves.toBe(0);
    await expect(
      test.prisma.platform.count({ where: { addedByImport: true } }),
    ).resolves.toBe(0);
    await expect(test.prisma.platform.count()).resolves.toBe(1);
    await expect(test.prisma.user.count()).resolves.toBe(1);
    await expect(test.prisma.session.count()).resolves.toBe(1);
    await expect(test.prisma.llmSetting.count()).resolves.toBe(1);
    await expect(loginStatus()).resolves.toBe(200);
  });
});
