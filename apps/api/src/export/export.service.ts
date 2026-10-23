import { Injectable, NotFoundException } from '@nestjs/common';
import { igdbUrlFor } from '../games/game-detail.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { toCsv, type CsvCell } from './csv';

const HEADERS = [
  'Title',
  'Platform',
  'Edition',
  'Year',
  'Publisher',
  'Genre',
  'Player count',
  'Copy count',
  'Rating',
  'Source',
  'IGDB link',
  'Date added',
] as const;

const SOURCE_LABELS: Record<string, string> = {
  IGDB: 'IGDB',
  MobyGames: 'MobyGames',
  MANUAL: 'manual',
};

/** Formats a date as `YYYY-MM-DD` in the server's local time zone. */
export function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

export function exportFilename(date: Date): string {
  return `gameshelf-${localDate(date)}.csv`;
}

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  /** The whole catalog, or only `platformId`'s games (unverified ones included). */
  async catalogCsv(platformId?: string): Promise<string> {
    if (platformId !== undefined) {
      const platform = await this.prisma.platform.findUnique({
        where: { id: platformId },
        select: { id: true },
      });
      if (!platform) {
        throw new NotFoundException(`Platform with id ${platformId} not found`);
      }
    }
    const games = await this.prisma.game.findMany({
      ...(platformId !== undefined && { where: { platformId } }),
      select: {
        id: true,
        title: true,
        platform: { select: { name: true } },
        edition: true,
        releaseYear: true,
        publisher: true,
        genre: true,
        playerCount: true,
        copyCount: true,
        rating: true,
        source: true,
        externalId: true,
        igdbSlug: true,
        createdAt: true,
      },
      orderBy: [{ title: 'asc' }, { platform: { name: 'asc' } }, { id: 'asc' }],
    });

    const rows: CsvCell[][] = games.map((game) => [
      game.title,
      game.platform.name,
      game.edition,
      game.releaseYear,
      game.publisher,
      game.genre,
      game.playerCount,
      game.copyCount,
      game.rating === null ? null : Math.round(game.rating),
      SOURCE_LABELS[game.source] ?? game.source,
      igdbUrlFor(game),
      localDate(game.createdAt),
    ]);
    return toCsv(HEADERS, rows);
  }
}
