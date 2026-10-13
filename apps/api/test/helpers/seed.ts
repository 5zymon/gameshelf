import { normalizePlatformName } from '../../src/platforms/platform-match';
import type { PrismaService } from '../../src/prisma/prisma.service';

export function seedPlatform(
  prisma: PrismaService,
  data: {
    name: string;
    slug: string;
    abbreviation?: string | null;
    alternativeName?: string | null;
    platformFamily?: number | null;
    igdbId?: number | null;
    addedByImport?: boolean;
    hidden?: boolean;
  },
) {
  return prisma.platform.create({
    data: {
      abbreviation: null,
      alternativeName: null,
      platformFamily: null,
      igdbId: null,
      ...data,
    },
  });
}

export function seedPlatformAlias(
  prisma: PrismaService,
  data: { platformId: string; name: string },
) {
  return prisma.platformAlias.create({
    data: {
      platformId: data.platformId,
      name: data.name,
      normalizedName: normalizePlatformName(data.name),
    },
  });
}

export function seedGame(
  prisma: PrismaService,
  data: {
    title: string;
    platformId: string;
    edition?: string | null;
    releaseYear?: number | null;
    publisher?: string | null;
    genre?: string | null;
    playerCount?: number | null;
    summary?: string | null;
    rating?: number | null;
    ratingCount?: number | null;
    copyCount?: number;
    coverUrl?: string | null;
    sourceCoverUrl?: string | null;
    source?: 'IGDB' | 'MobyGames' | 'MANUAL';
    enrichedAt?: Date | null;
    rawMetadata?: string | null;
    externalId?: number | null;
    igdbSlug?: string | null;
    platformUnverified?: boolean;
    userEditedFields?: string | null;
  },
) {
  return prisma.game.create({
    data: {
      edition: null,
      releaseYear: null,
      publisher: null,
      genre: null,
      playerCount: null,
      coverUrl: null,
      ...data,
    },
  });
}

export function seedUser(
  prisma: PrismaService,
  data: { email: string; passwordHash?: string },
) {
  return prisma.user.create({
    data: {
      email: data.email,
      passwordHash: data.passwordHash ?? 'placeholder',
    },
  });
}

/** A configured `custom` LLM settings row (id 1); the key comes from `CUSTOM_API_KEY`. */
export function seedLlmSettings(
  prisma: PrismaService,
  data: { baseUrl?: string } = {},
) {
  return prisma.llmSetting.create({
    data: {
      id: 1,
      provider: 'custom',
      baseUrl: data.baseUrl ?? 'http://localhost:11434/v1',
    },
  });
}
