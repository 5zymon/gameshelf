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

export function seedGame(
  prisma: PrismaService,
  data: {
    title: string;
    platformId: number;
    edition?: string | null;
    releaseYear?: number | null;
    publisher?: string | null;
    genre?: string | null;
    playerCount?: number | null;
    coverUrl?: string | null;
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
