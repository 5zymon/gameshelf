import { toGameDetail } from '../../src/games/game-detail.mapper';
import type { GameDetailRow } from '../../src/games/game-detail.mapper';

function row(overrides: Partial<GameDetailRow> = {}): GameDetailRow {
  return {
    id: 1,
    title: 'Halo: Combat Evolved',
    platformId: 3,
    edition: null,
    releaseYear: 2001,
    publisher: 'Bungie',
    genre: 'Shooter',
    playerCount: 16,
    copyCount: 1,
    coverUrl: '/api/covers/abc.jpg',
    sourceCoverUrl:
      'https://images.igdb.com/igdb/image/upload/t_1080p/co61gh.jpg',
    rawMetadata: null,
    enrichedAt: null,
    source: 'IGDB',
    externalId: 1036,
    platformUnverified: false,
    userEditedFields: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    platform: { id: 3, name: 'Xbox', slug: 'xbox' },
    images: [{ url: '/api/covers/img1.jpg' }, { url: '/api/covers/img2.jpg' }],
    ...overrides,
  };
}

describe('toGameDetail (unit)', () => {
  it('maps the ordered gallery to url + derived thumbUrl and strips sourceCoverUrl', () => {
    const detail = toGameDetail(row());

    expect(detail.images).toEqual([
      { url: '/api/covers/img1.jpg', thumbUrl: '/api/covers/thumbs/img1.jpg' },
      { url: '/api/covers/img2.jpg', thumbUrl: '/api/covers/thumbs/img2.jpg' },
    ]);
    expect(detail).not.toHaveProperty('sourceCoverUrl');
    expect(detail.coverThumbUrl).toBe('/api/covers/thumbs/abc.jpg');
  });

  it('maps an empty gallery to an empty array', () => {
    const detail = toGameDetail(row({ images: [] }));

    expect(detail.images).toEqual([]);
  });
});
