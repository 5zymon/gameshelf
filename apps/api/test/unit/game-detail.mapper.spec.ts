import {
  igdbUrlFor,
  toGameDetail,
  toGameListItem,
} from '../../src/games/game-detail.mapper';
import type {
  GameDetailRow,
  GameListRow,
} from '../../src/games/game-detail.mapper';

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
    summary: 'Desc',
    rating: 78.4,
    ratingCount: 512,
    copyCount: 1,
    coverUrl: '/api/covers/abc.jpg',
    sourceCoverUrl:
      'https://images.igdb.com/igdb/image/upload/t_1080p/co61gh.jpg',
    rawMetadata: null,
    enrichedAt: null,
    source: 'IGDB',
    externalId: 1036,
    igdbSlug: 'halo-combat-evolved',
    platformUnverified: false,
    userEditedFields: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    platform: { id: 3, name: 'Xbox', slug: 'xbox' },
    images: [{ url: '/api/covers/img1.jpg' }, { url: '/api/covers/img2.jpg' }],
    videos: [{ id: 7, videoId: 'AbCdEfGhIj0', name: 'Trailer' }],
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

  it('exposes igdbUrl for an IGDB game with a stored slug and never the slug itself', () => {
    const detail = toGameDetail(row());

    expect(detail.igdbUrl).toBe(
      'https://www.igdb.com/games/halo-combat-evolved',
    );
    expect(detail).not.toHaveProperty('igdbSlug');
  });

  it('exposes a null igdbUrl for every game that is not IGDB-linked with a slug', () => {
    expect(toGameDetail(row({ source: 'MobyGames' })).igdbUrl).toBeNull();
    expect(
      toGameDetail(row({ source: 'MANUAL', externalId: null })).igdbUrl,
    ).toBeNull();
    expect(toGameDetail(row({ externalId: null })).igdbUrl).toBeNull();
    expect(toGameDetail(row({ igdbSlug: null })).igdbUrl).toBeNull();
  });

  it('exposes summary, rating, ratingCount and the ordered videos', () => {
    const detail = toGameDetail(row());

    expect(detail.summary).toBe('Desc');
    expect(detail.rating).toBe(78.4);
    expect(detail.ratingCount).toBe(512);
    expect(detail.videos).toEqual([
      { id: 7, name: 'Trailer', videoId: 'AbCdEfGhIj0' },
    ]);
  });
});

describe('toGameListItem (unit)', () => {
  it('passes the rating through (null stays null)', () => {
    const item = toGameListItem({
      id: 1,
      title: 'Halo',
      edition: null,
      coverUrl: null,
      rating: null,
      platform: { id: 3, name: 'Xbox', slug: 'xbox' },
    } satisfies GameListRow);

    expect(item.rating).toBeNull();
  });
});

describe('igdbUrlFor (unit)', () => {
  it('encodes the slug into the canonical IGDB game path', () => {
    expect(
      igdbUrlFor({ source: 'IGDB', externalId: 1, igdbSlug: 'a b/c' }),
    ).toBe('https://www.igdb.com/games/a%20b%2Fc');
  });
});
