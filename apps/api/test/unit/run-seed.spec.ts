import type { PlatformMatchCandidate } from '../../src/platforms/platform-match';
import type { CanonicalPlatformInput } from '../../src/platforms/platforms.service';
import {
  SEED_GAMES,
  SEED_PLATFORMS,
  SEED_QA_USER,
  seedDevData,
  type SeedDeps,
} from '../../src/cli/seed-data';
import { runSeedCli, type SeedCliDeps } from '../../src/cli/run-seed';

const TARGET = 'gameshelf@db.internal:3306';

interface Harness {
  deps: SeedCliDeps;
  seed: jest.Mock;
  out: string[];
  err: string[];
}

function createHarness(overrides: Partial<SeedCliDeps> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const seed = jest.fn().mockResolvedValue({
    user: 'created',
    platformsCreated: 3,
    platformsReused: 0,
    gamesCreated: 6,
    gamesSkipped: 0,
  });
  const deps: SeedCliDeps = {
    nodeEnv: 'development',
    target: TARGET,
    seed,
    out: (line) => {
      out.push(line);
    },
    err: (line) => {
      err.push(line);
    },
    ...overrides,
  };
  return { deps, seed, out, err };
}

describe('runSeedCli', () => {
  it('refuses when NODE_ENV is test without seeding', async () => {
    const harness = createHarness({ nodeEnv: 'test' });

    const code = await runSeedCli(harness.deps);

    expect(code).toBe(1);
    expect(harness.seed).not.toHaveBeenCalled();
    expect(harness.err.join('\n')).toContain(
      'NODE_ENV=development (current: test)',
    );
  });

  it('refuses when NODE_ENV is unset', async () => {
    const harness = createHarness({ nodeEnv: undefined });

    const code = await runSeedCli(harness.deps);

    expect(code).toBe(1);
    expect(harness.seed).not.toHaveBeenCalled();
    expect(harness.err.join('\n')).toContain('(current: unset)');
  });

  it('seeds and prints the summary and the QA credentials', async () => {
    const harness = createHarness();

    const code = await runSeedCli(harness.deps);

    expect(code).toBe(0);
    expect(harness.out).toEqual([
      `Seeding ${TARGET}`,
      'Dev data seeded: user=created platformsCreated=3 platformsReused=0 gamesCreated=6 gamesSkipped=0',
      `QA account: ${SEED_QA_USER.email} / ${SEED_QA_USER.password}`,
    ]);
  });

  it('reports a seed failure and returns 1', async () => {
    const harness = createHarness({
      seed: jest.fn().mockRejectedValue(new Error('boom')),
    });

    const code = await runSeedCli(harness.deps);

    expect(code).toBe(1);
    expect(harness.err).toEqual(['Error: boom']);
  });
});

/** The three seed platforms as matcher candidates (an already-synced DB). */
const MATCHING_CANDIDATES: readonly PlatformMatchCandidate[] =
  SEED_PLATFORMS.map((platform, index) => ({
    id: index + 1,
    name: platform.name,
    abbreviation: platform.abbreviation,
    alternativeName: null,
  }));

/** The six seed games as existing rows, matched by identity. */
const ALL_GAMES_PRESENT = SEED_GAMES.map((game, index) => ({
  title: game.title,
  platformId: index < 2 ? 1 : index < 4 ? 2 : 3,
  edition: game.edition,
  source: 'MANUAL',
  externalId: null,
}));

interface SeedHarness {
  deps: SeedDeps;
  findByEmail: jest.Mock;
  createUser: jest.Mock;
  setPassword: jest.Mock;
  listMatchCandidates: jest.Mock;
  createCanonical: jest.Mock;
  gameFindMany: jest.Mock;
  gameCreate: jest.Mock;
}

function createSeedHarness(
  overrides: {
    findByEmail?: jest.Mock;
    listMatchCandidates?: jest.Mock;
    gameFindMany?: jest.Mock;
  } = {},
): SeedHarness {
  let nextPlatformId = 1;
  const findByEmail =
    overrides.findByEmail ?? jest.fn().mockResolvedValue(null);
  const createUser = jest.fn().mockResolvedValue({});
  const setPassword = jest.fn().mockResolvedValue({});
  const listMatchCandidates =
    overrides.listMatchCandidates ?? jest.fn().mockResolvedValue([]);
  const createCanonical = jest
    .fn()
    .mockImplementation((input: CanonicalPlatformInput) => {
      const id = nextPlatformId;
      nextPlatformId += 1;
      return {
        id,
        name: input.name,
        abbreviation: input.abbreviation,
        alternativeName: input.alternativeName,
      };
    });
  const gameFindMany =
    overrides.gameFindMany ?? jest.fn().mockResolvedValue([]);
  const gameCreate = jest.fn().mockResolvedValue({});
  const deps: SeedDeps = {
    prisma: { game: { findMany: gameFindMany, create: gameCreate } },
    users: { findByEmail, createUser, setPassword },
    platforms: { listMatchCandidates, createCanonical },
  } as unknown as SeedDeps;
  return {
    deps,
    findByEmail,
    createUser,
    setPassword,
    listMatchCandidates,
    createCanonical,
    gameFindMany,
    gameCreate,
  };
}

describe('seedDevData', () => {
  it('creates the QA user, the three platforms and the six games on an empty database', async () => {
    const harness = createSeedHarness();

    const result = await seedDevData(harness.deps);

    expect(harness.findByEmail).toHaveBeenCalledWith(SEED_QA_USER.email);
    expect(harness.createUser).toHaveBeenCalledTimes(1);
    expect(harness.createUser).toHaveBeenCalledWith(SEED_QA_USER);
    expect(harness.setPassword).not.toHaveBeenCalled();
    expect(harness.createCanonical).toHaveBeenCalledTimes(3);
    expect(harness.createCanonical).toHaveBeenNthCalledWith(
      1,
      SEED_PLATFORMS[0],
    );
    expect(harness.createCanonical).toHaveBeenNthCalledWith(
      2,
      SEED_PLATFORMS[1],
    );
    expect(harness.createCanonical).toHaveBeenNthCalledWith(
      3,
      SEED_PLATFORMS[2],
    );
    expect(harness.gameCreate).toHaveBeenCalledTimes(6);
    const createCalls = harness.gameCreate.mock.calls as [
      { data: { source: string } },
    ][];
    for (const [{ data }] of createCalls) {
      expect(data.source).toBe('MANUAL');
    }
    expect(result).toEqual({
      user: 'created',
      platformsCreated: 3,
      platformsReused: 0,
      gamesCreated: 6,
      gamesSkipped: 0,
    });
  });

  it('resets the password and reuses everything when the seed already exists', async () => {
    const harness = createSeedHarness({
      findByEmail: jest.fn().mockResolvedValue({
        id: 1,
        email: SEED_QA_USER.email,
        passwordHash: 'hash',
        language: 'pl',
        theme: 'system',
        createdAt: new Date(),
      }),
      listMatchCandidates: jest.fn().mockResolvedValue(MATCHING_CANDIDATES),
      gameFindMany: jest.fn().mockResolvedValue(ALL_GAMES_PRESENT),
    });

    const result = await seedDevData(harness.deps);

    expect(harness.setPassword).toHaveBeenCalledTimes(1);
    expect(harness.setPassword).toHaveBeenCalledWith(SEED_QA_USER);
    expect(harness.createUser).not.toHaveBeenCalled();
    expect(harness.createCanonical).not.toHaveBeenCalled();
    expect(harness.gameCreate).not.toHaveBeenCalled();
    expect(result).toEqual({
      user: 'updated',
      platformsCreated: 0,
      platformsReused: 3,
      gamesCreated: 0,
      gamesSkipped: 6,
    });
  });

  it('skips a game whose identity already exists, ignoring case', async () => {
    const harness = createSeedHarness({
      listMatchCandidates: jest.fn().mockResolvedValue(MATCHING_CANDIDATES),
      gameFindMany: jest.fn().mockResolvedValue([
        {
          title: 'hades',
          platformId: 1,
          edition: null,
          source: 'MANUAL',
          externalId: null,
        },
      ]),
    });

    const result = await seedDevData(harness.deps);

    expect(harness.gameCreate).toHaveBeenCalledTimes(5);
    const firstCreate = harness.gameCreate.mock.calls[0] as [
      { data: { title: string } },
    ];
    expect(firstCreate[0].data.title).toBe('Disco Elysium');
    expect(result).toEqual({
      user: 'created',
      platformsCreated: 0,
      platformsReused: 3,
      gamesCreated: 5,
      gamesSkipped: 1,
    });
  });
});
