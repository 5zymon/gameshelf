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

function createService(rows: GameRow[]): {
  service: ExportService;
  findMany: jest.Mock;
} {
  const findMany = jest.fn().mockResolvedValue(rows);
  return {
    service: new ExportService({
      game: { findMany },
    } as unknown as PrismaService),
    findMany,
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
