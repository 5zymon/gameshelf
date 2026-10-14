import { isSameGameIdentity } from '../games/game-identity';
import { findPlatformMatch } from '../platforms/platform-match';
import type {
  CanonicalPlatformInput,
  PlatformsService,
} from '../platforms/platforms.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../auth/users.service';

/** Documented QA account (AGENTS.md, docs/features/dev-seed.md). Dev only. */
export const SEED_QA_USER = {
  email: 'qa@gameshelf.local',
  password: 'gameshelf-qa-password',
} as const;

/** IGDB-canonical names/ids, so `platforms:sync` matches these rows by name. */
export const SEED_PLATFORMS: readonly CanonicalPlatformInput[] = [
  {
    name: 'PC (Microsoft Windows)',
    abbreviation: 'PC',
    alternativeName: null,
    platformFamily: null,
    igdbId: 6,
  },
  {
    name: 'PlayStation 5',
    abbreviation: 'PS5',
    alternativeName: null,
    platformFamily: 1,
    igdbId: 167,
  },
  {
    name: 'Nintendo Switch',
    abbreviation: 'Switch',
    alternativeName: null,
    platformFamily: 5,
    igdbId: 130,
  },
];

export interface SeedGame {
  title: string;
  /** Must equal a `SEED_PLATFORMS` name. */
  platform: string;
  edition: string | null;
  releaseYear: number;
  publisher: string;
  genre: string;
  playerCount: number;
  copyCount: number;
}

/**
 * Six `MANUAL` sample games: varied platforms, years, publishers and genres (to
 * exercise the catalog filters), one edition, one `copyCount: 2`, one
 * multiplayer. No covers, summary or rating: these are manual rows and must not
 * pretend to come from IGDB.
 */
export const SEED_GAMES: readonly SeedGame[] = [
  {
    title: 'Hades',
    platform: 'PC (Microsoft Windows)',
    edition: null,
    releaseYear: 2020,
    publisher: 'Supergiant Games',
    genre: 'Role-playing (RPG)',
    playerCount: 1,
    copyCount: 1,
  },
  {
    title: 'Disco Elysium',
    platform: 'PC (Microsoft Windows)',
    edition: 'The Final Cut',
    releaseYear: 2021,
    publisher: 'ZA/UM',
    genre: 'Role-playing (RPG)',
    playerCount: 1,
    copyCount: 1,
  },
  {
    title: 'Elden Ring',
    platform: 'PlayStation 5',
    edition: null,
    releaseYear: 2022,
    publisher: 'Bandai Namco Entertainment',
    genre: 'Adventure',
    playerCount: 1,
    copyCount: 2,
  },
  {
    title: 'Astro Bot',
    platform: 'PlayStation 5',
    edition: null,
    releaseYear: 2024,
    publisher: 'Sony Interactive Entertainment',
    genre: 'Platform',
    playerCount: 1,
    copyCount: 1,
  },
  {
    title: 'Mario Kart 8 Deluxe',
    platform: 'Nintendo Switch',
    edition: null,
    releaseYear: 2017,
    publisher: 'Nintendo',
    genre: 'Racing',
    playerCount: 4,
    copyCount: 1,
  },
  {
    title: 'The Legend of Zelda: Tears of the Kingdom',
    platform: 'Nintendo Switch',
    edition: null,
    releaseYear: 2023,
    publisher: 'Nintendo',
    genre: 'Adventure',
    playerCount: 1,
    copyCount: 1,
  },
];

export interface SeedResult {
  user: 'created' | 'updated';
  platformsCreated: number;
  platformsReused: number;
  gamesCreated: number;
  gamesSkipped: number;
}

export interface SeedDeps {
  prisma: PrismaService;
  users: Pick<UsersService, 'findByEmail' | 'createUser' | 'setPassword'>;
  platforms: Pick<PlatformsService, 'listMatchCandidates' | 'createCanonical'>;
}

/**
 * Seeds the QA account, the three canonical platforms and the six sample
 * games. Idempotent: re-running resets the QA password, reuses existing
 * platforms by name, and skips games whose identity already exists.
 *
 * Errors propagate. The writes are deliberately not wrapped in a transaction:
 * each step is idempotent, so re-running after a partial failure completes the
 * seed.
 */
export async function seedDevData(deps: SeedDeps): Promise<SeedResult> {
  const { prisma, users, platforms } = deps;

  // 1. User: create if absent, otherwise reset the documented password.
  const existingUser = await users.findByEmail(SEED_QA_USER.email);
  let user: SeedResult['user'];
  if (existingUser === null) {
    await users.createUser(SEED_QA_USER);
    user = 'created';
  } else {
    await users.setPassword(SEED_QA_USER);
    user = 'updated';
  }

  // 2. Platforms: reuse by name (the same matcher `platforms:sync` uses),
  //    create the rest with their canonical fields.
  const candidates = await platforms.listMatchCandidates();
  const ids = new Map<string, string>();
  let platformsCreated = 0;
  let platformsReused = 0;
  for (const input of SEED_PLATFORMS) {
    const match = findPlatformMatch(candidates, [input.name]);
    if (match !== null) {
      ids.set(input.name, match.id);
      platformsReused += 1;
      continue;
    }
    const row = await platforms.createCanonical(input);
    candidates.push(row);
    ids.set(input.name, row.id);
    platformsCreated += 1;
  }

  // 3. Games: skip any identity already present (the same rule as manual add).
  const existing = await prisma.game.findMany({
    where: { platformId: { in: [...ids.values()] } },
    select: {
      title: true,
      platformId: true,
      edition: true,
      source: true,
      externalId: true,
    },
  });
  let gamesCreated = 0;
  let gamesSkipped = 0;
  for (const game of SEED_GAMES) {
    const platformId = ids.get(game.platform);
    if (platformId === undefined) {
      throw new Error(`Seed platform missing: ${game.platform}`);
    }
    const identity = {
      title: game.title,
      platformId,
      edition: game.edition,
      source: 'MANUAL' as const,
      externalId: null,
    };
    if (existing.some((row) => isSameGameIdentity(row, identity))) {
      gamesSkipped += 1;
      continue;
    }
    await prisma.game.create({
      data: {
        title: game.title,
        platformId,
        edition: game.edition,
        releaseYear: game.releaseYear,
        publisher: game.publisher,
        genre: game.genre,
        playerCount: game.playerCount,
        copyCount: game.copyCount,
        source: 'MANUAL',
      },
    });
    existing.push(identity);
    gamesCreated += 1;
  }

  return {
    user,
    platformsCreated,
    platformsReused,
    gamesCreated,
    gamesSkipped,
  };
}
