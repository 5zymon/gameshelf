import { NotFoundException } from '@nestjs/common';
import {
  exportFilename,
  ExportService,
  localDate,
} from '../../src/export/export.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

const HEADER_LINE =
  'Title,Platform,Edition,Year,Publisher,Genre,Player count,Copy count,Rating,Source,IGDB link,Date added';

interface GameRow {
  id: string;
  title: string;
  platform: { name: string };
  edition: string | null;
  releaseYear: number | null;
  publisher: string | null;
  genre: string | null;
  playerCount: number | null;
  copyCount: number;
  rating: number | null;
  source: 'IGDB' | 'MobyGames' | 'MANUAL';
  externalId: number | null;
  igdbSlug: string | null;
  createdAt: Date;
}

function row(overrides: Partial<GameRow> = {}): GameRow {
  return {
    id: 'g1',
    title: 'Zelda',
    platform: { name: 'Switch' },
    edition: null,
    releaseYear: null,
    publisher: null,
    genre: null,
    playerCount: null,
    copyCount: 1,
    rating: null,
    source: 'MANUAL',
    externalId: null,
    igdbSlug: null,
    createdAt: new Date(2026, 9, 2, 12, 0, 0),
    ...overrides,
  };
}

function createService(
  rows: GameRow[],
  platform: { id: string } | null = { id: 'p1' },
): {
  service: ExportService;
  findMany: jest.Mock;
  findUnique: jest.Mock;
} {
  const findMany = jest.fn().mockResolvedValue(rows);
  const findUnique = jest.fn().mockResolvedValue(platform);
  return {
    service: new ExportService({
      game: { findMany },
      platform: { findUnique },
    } as unknown as PrismaService),
    findMany,
    findUnique,
  };
}

function cell(line: string | undefined, index: number): string | undefined {
  return line?.split(',')[index];
}

async function lines(rows: GameRow[]): Promise<string[]> {
  const { service } = createService(rows);
  const csv = await service.catalogCsv();
  return csv.split('\r\n');
}

describe('ExportService', () => {
  it('orders by title, platform name, id and selects the needed fields', async () => {
    const { service, findMany } = createService([]);

    await service.catalogCsv();

    expect(findMany).toHaveBeenCalledWith({
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
  });

  it('returns only the header row for an empty collection', async () => {
    const { service } = createService([]);

    await expect(service.catalogCsv()).resolves.toBe(`${HEADER_LINE}\r\n`);
  });

  it('writes every column in order', async () => {
    const out = await lines([
      row({
        title: 'Halo',
        platform: { name: 'Xbox' },
        edition: 'GOTY',
        releaseYear: 2001,
        publisher: 'Microsoft',
        genre: 'Shooter',
        playerCount: 4,
        copyCount: 2,
        rating: 90,
        source: 'MobyGames',
      }),
    ]);

    expect(out[0]).toBe(HEADER_LINE);
    expect(out[1]).toBe(
      'Halo,Xbox,GOTY,2001,Microsoft,Shooter,4,2,90,MobyGames,,2026-10-02',
    );
    expect(out[2]).toBe('');
  });

  it('renders null fields as empty cells', async () => {
    const out = await lines([row()]);

    expect(out[1]).toBe('Zelda,Switch,,,,,,1,,manual,,2026-10-02');
  });

  it.each([
    [72.5, '73'],
    [72.4, '72'],
    [null, ''],
  ])('renders rating %s as "%s"', async (rating, expected) => {
    const out = await lines([row({ rating })]);

    expect(cell(out[1], 8)).toBe(expected);
  });

  it.each([
    ['IGDB', 'IGDB'],
    ['MobyGames', 'MobyGames'],
    ['MANUAL', 'manual'],
  ] as const)('maps source %s to %s', async (source, expected) => {
    const out = await lines([row({ source })]);

    expect(cell(out[1], 9)).toBe(expected);
  });

  it('adds the IGDB link only for an IGDB game with a slug and an externalId', async () => {
    const out = await lines([
      row({ title: 'A', source: 'IGDB', externalId: 7, igdbSlug: 'a-game' }),
      row({ title: 'B', source: 'IGDB', externalId: 7, igdbSlug: null }),
      row({ title: 'C', source: 'IGDB', externalId: null, igdbSlug: 'c' }),
      row({ title: 'D', source: 'MANUAL', externalId: 7, igdbSlug: 'd' }),
    ]);

    expect(cell(out[1], 10)).toMatch(/^https:\/\/.*a-game$/);
    expect(cell(out[2], 10)).toBe('');
    expect(cell(out[3], 10)).toBe('');
    expect(cell(out[4], 10)).toBe('');
  });

  it('quotes cells that need it', async () => {
    const out = await lines([row({ title: 'Mario, "Kart"' })]);

    expect(out[1]?.startsWith('"Mario, ""Kart""",Switch,')).toBe(true);
  });
});

function firstArg(mock: jest.Mock): { select: unknown } {
  const calls = mock.mock.calls as [{ select: unknown }][];
  return calls[0]?.[0] ?? { select: undefined };
}

describe('ExportService.catalogCsv(platformId)', () => {
  const PLATFORM_ID = '01900000-0000-7000-8000-000000000001';

  it('checks the platform and filters the games by it', async () => {
    const { service, findMany, findUnique } = createService([row()]);

    await service.catalogCsv(PLATFORM_ID);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: PLATFORM_ID },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { platformId: PLATFORM_ID },
        orderBy: [
          { title: 'asc' },
          { platform: { name: 'asc' } },
          { id: 'asc' },
        ],
      }),
    );
  });

  it('keeps the same select as the whole-catalog query', async () => {
    const whole = createService([]);
    const one = createService([]);

    await whole.service.catalogCsv();
    await one.service.catalogCsv(PLATFORM_ID);

    expect(firstArg(one.findMany).select).toEqual(
      firstArg(whole.findMany).select,
    );
  });

  it('does not look up a platform or filter without a platformId', async () => {
    const { service, findMany, findUnique } = createService([]);

    await service.catalogCsv();

    expect(findUnique).not.toHaveBeenCalled();
    expect(firstArg(findMany)).not.toHaveProperty('where');
  });

  it('rejects an unknown platform with NotFoundException and reads no games', async () => {
    const { service, findMany } = createService([], null);

    await expect(service.catalogCsv(PLATFORM_ID)).rejects.toThrow(
      new NotFoundException(`Platform with id ${PLATFORM_ID} not found`),
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns exactly the header line for a platform with no games', async () => {
    const { service } = createService([]);

    await expect(service.catalogCsv(PLATFORM_ID)).resolves.toBe(
      `${HEADER_LINE}\r\n`,
    );
  });
});

describe('localDate / exportFilename', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('builds the filename', () => {
    expect(exportFilename(new Date(2026, 9, 2))).toBe(
      'gameshelf-2026-10-02.csv',
    );
  });
});
