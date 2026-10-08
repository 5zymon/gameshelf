import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { GameDatabaseStatusService } from '../../src/settings/game-database-status.service';

interface ConfigMock {
  get: jest.Mock;
}

interface PrismaMock {
  importQueueState: {
    findUnique: jest.Mock;
  };
}

function createService(): {
  service: GameDatabaseStatusService;
  config: ConfigMock;
  prisma: PrismaMock;
} {
  const config: ConfigMock = { get: jest.fn() };
  const prisma: PrismaMock = {
    importQueueState: { findUnique: jest.fn(() => Promise.resolve(null)) },
  };
  return {
    service: new GameDatabaseStatusService(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
    ),
    config,
    prisma,
  };
}

/** Config lookup backed by a plain env map; unknown keys are absent. */
function withEnv(values: Record<string, string>): ConfigMock {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

describe('GameDatabaseStatusService', () => {
  it('reports both databases missing when no env key is set', async () => {
    const { service, config, prisma } = createService();
    config.get.mockReturnValue(undefined);

    await expect(service.list()).resolves.toEqual([
      { id: 'igdb', label: 'IGDB', state: 'missing', message: null },
      { id: 'mobygames', label: 'MobyGames', state: 'missing', message: null },
    ]);
    expect(prisma.importQueueState.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });

  it('reports both databases configured when every key is present', async () => {
    const config = withEnv({
      IGDB_CLIENT_ID: 'id',
      IGDB_CLIENT_SECRET: 'secret',
      MOBYGAMES_API_KEY: 'key',
    });
    const prisma: PrismaMock = {
      importQueueState: { findUnique: jest.fn(() => Promise.resolve(null)) },
    };
    const service = new GameDatabaseStatusService(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );

    await expect(service.list()).resolves.toEqual([
      { id: 'igdb', label: 'IGDB', state: 'configured', message: null },
      {
        id: 'mobygames',
        label: 'MobyGames',
        state: 'configured',
        message: null,
      },
    ]);
  });

  it('reports the paused provider rejected and keeps the others configured', async () => {
    const { service, config, prisma } = createService();
    config.get.mockReturnValue('set');
    prisma.importQueueState.findUnique.mockResolvedValue({
      paused: true,
      source: 'igdb',
      reason: 'IGDB rejected the credentials',
    });

    await expect(service.list()).resolves.toEqual([
      {
        id: 'igdb',
        label: 'IGDB',
        state: 'rejected',
        message: 'IGDB rejected the credentials',
      },
      {
        id: 'mobygames',
        label: 'MobyGames',
        state: 'configured',
        message: null,
      },
    ]);
  });

  it('reports MobyGames rejected when the pause source is mobygames', async () => {
    const { service, config, prisma } = createService();
    config.get.mockReturnValue('set');
    prisma.importQueueState.findUnique.mockResolvedValue({
      paused: true,
      source: 'mobygames',
      reason: 'MobyGames rejected the credentials',
    });

    const result = await service.list();
    await expect(Promise.resolve(result[1])).resolves.toEqual({
      id: 'mobygames',
      label: 'MobyGames',
      state: 'rejected',
      message: 'MobyGames rejected the credentials',
    });
  });

  it('prefers missing over rejected when the env key is absent', async () => {
    const { service, config, prisma } = createService();
    config.get.mockReturnValue(undefined);
    prisma.importQueueState.findUnique.mockResolvedValue({
      paused: true,
      source: 'igdb',
      reason: 'IGDB rejected the credentials',
    });

    const result = await service.list();
    expect(result[0]).toEqual({
      id: 'igdb',
      label: 'IGDB',
      state: 'missing',
      message: null,
    });
  });

  it('treats a whitespace-only env value as missing', async () => {
    const { service, config } = createService();
    config.get.mockReturnValue('   ');

    await expect(service.list()).resolves.toEqual([
      { id: 'igdb', label: 'IGDB', state: 'missing', message: null },
      { id: 'mobygames', label: 'MobyGames', state: 'missing', message: null },
    ]);
  });
});
