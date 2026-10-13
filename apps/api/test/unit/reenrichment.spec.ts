import type { EnrichedGameData } from '../../src/enrichment/game-enrichment.service';
import {
  buildReenrichmentUpdate,
  mergeEditedFields,
  parseEditedFields,
  serializeEditedFields,
  toEditedFields,
  TRACKED_METADATA_FIELDS,
  type ReenrichmentExisting,
} from '../../src/enrichment/reenrichment';
import { testId } from '../helpers/ids';

function existing(
  overrides: Partial<ReenrichmentExisting> = {},
): ReenrichmentExisting {
  return {
    id: testId(1),
    releaseYear: null,
    publisher: null,
    genre: null,
    playerCount: null,
    summary: null,
    rating: null,
    ratingCount: null,
    coverUrl: null,
    sourceCoverUrl: null,
    rawMetadata: null,
    source: 'MANUAL',
    externalId: null,
    igdbSlug: null,
    platformUnverified: false,
    userEditedFields: null,
    images: [],
    videos: [],
    ...overrides,
  };
}

function enriched(overrides: Partial<EnrichedGameData> = {}): EnrichedGameData {
  return {
    title: 'Halo: Combat Evolved',
    platformId: testId(3),
    edition: null,
    releaseYear: 2001,
    publisher: 'Bungie',
    genre: 'Shooter',
    playerCount: 16,
    summary: 'Halo is…',
    rating: 78.4,
    ratingCount: 512,
    coverUrl: '/api/covers/abc.jpg',
    sourceCoverUrl:
      'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
    rawMetadata: JSON.stringify({ id: 1036 }),
    enrichedAt: new Date('2026-10-07T00:00:00.000Z'),
    source: 'IGDB',
    externalId: 1036,
    igdbSlug: 'halo-combat-evolved',
    images: [],
    videos: [],
    ...overrides,
  };
}

describe('provenance serialization', () => {
  it('parses a JSON array and drops unknown/duplicate names', () => {
    expect(parseEditedFields('["publisher","bogus","publisher"]')).toEqual([
      'publisher',
    ]);
  });

  it('accepts an already-parsed array (the response model)', () => {
    expect(parseEditedFields(['genre', 'coverUrl', 'genre'])).toEqual([
      'coverUrl',
      'genre',
    ]);
  });

  it('tolerates null and garbage', () => {
    expect(parseEditedFields(null)).toEqual([]);
    expect(parseEditedFields(undefined)).toEqual([]);
    expect(parseEditedFields('not json')).toEqual([]);
    expect(parseEditedFields('{"a":1}')).toEqual([]);
    expect(parseEditedFields(42)).toEqual([]);
    expect(toEditedFields('nope').size).toBe(0);
  });

  it('serializes sorted, unique, known fields only', () => {
    expect(
      serializeEditedFields(['publisher', 'genre', 'publisher', 'bogus']),
    ).toBe('["genre","publisher"]');
    expect(serializeEditedFields([])).toBe('[]');
  });

  it('round-trips through serialize → parse', () => {
    const fields = [...TRACKED_METADATA_FIELDS];
    expect(parseEditedFields(serializeEditedFields(fields))).toEqual(
      [...TRACKED_METADATA_FIELDS].sort(),
    );
  });

  it('merges existing provenance with newly edited fields', () => {
    expect(mergeEditedFields('["publisher"]', ['genre', 'bogus'])).toEqual([
      'genre',
      'publisher',
    ]);
    expect(mergeEditedFields(null, ['publisher'])).toEqual(['publisher']);
    expect(mergeEditedFields('["publisher"]', [])).toEqual(['publisher']);
  });
});

describe('buildReenrichmentUpdate', () => {
  it('returns null when an identical candidate changes nothing', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: 16,
        summary: 'Halo is…',
        rating: 78.4,
        ratingCount: 512,
        coverUrl: '/api/covers/abc.jpg',
        sourceCoverUrl:
          'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
        source: 'IGDB',
        externalId: 1036,
        igdbSlug: 'halo-combat-evolved',
      }),
      enriched: enriched(),
    });

    expect(data).toBeNull();
  });

  it('fills fields on a fresh (MANUAL) row and links the source', () => {
    const data = buildReenrichmentUpdate({
      existing: existing(),
      enriched: enriched(),
    });

    expect(data).toEqual({
      releaseYear: 2001,
      publisher: 'Bungie',
      genre: 'Shooter',
      playerCount: 16,
      summary: 'Halo is…',
      rating: 78.4,
      ratingCount: 512,
      coverUrl: '/api/covers/abc.jpg',
      sourceCoverUrl:
        'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
      source: 'IGDB',
      externalId: 1036,
      igdbSlug: 'halo-combat-evolved',
      rawMetadata: JSON.stringify({ id: 1036 }),
      enrichedAt: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('never nulls an existing value when the candidate provides null', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({
        releaseYear: 1999,
        publisher: 'Old',
        genre: 'Old',
        playerCount: 2,
        summary: 'Old description',
        rating: 50,
        ratingCount: 10,
        coverUrl: '/old.jpg',
        source: 'MobyGames',
        externalId: 7,
      }),
      enriched: enriched({
        releaseYear: null,
        publisher: null,
        genre: null,
        playerCount: null,
        summary: null,
        rating: null,
        ratingCount: null,
        coverUrl: null,
        sourceCoverUrl: null,
        source: 'IGDB',
        externalId: 7,
      }),
    });

    // Only the source and its slug changed; every candidate-null field is left untouched.
    expect(data).toEqual({
      source: 'IGDB',
      igdbSlug: 'halo-combat-evolved',
      rawMetadata: JSON.stringify({ id: 1036 }),
      enrichedAt: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('never emits title, platformId, or edition', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({ source: 'IGDB', externalId: 1036 }),
      enriched: enriched({
        title: 'Different Title',
        platformId: testId(99),
        edition: 'GOTY',
      }),
    });

    expect(data).not.toBeNull();
    expect(data).not.toHaveProperty('title');
    expect(data).not.toHaveProperty('platformId');
    expect(data).not.toHaveProperty('edition');
  });

  it('stores the IGDB slug on re-enrichment of a game enriched before slugs existed', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({ source: 'IGDB', externalId: 1036, igdbSlug: null }),
      enriched: enriched(),
    });

    expect(data).toMatchObject({ igdbSlug: 'halo-combat-evolved' });
  });

  it('never overwrites a hand-edited field', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({ source: 'IGDB', externalId: 1036 }),
      enriched: enriched({ coverUrl: '/new.jpg' }),
      editedFields: new Set(['publisher', 'coverUrl']),
    });

    expect(data).not.toBeNull();
    expect(data).not.toHaveProperty('publisher');
    expect(data).not.toHaveProperty('coverUrl');
    expect(data).toMatchObject({ genre: 'Shooter', playerCount: 16 });
  });

  it('replaces a changed cover but keeps it when the candidate has none', () => {
    const replaced = buildReenrichmentUpdate({
      existing: existing({
        coverUrl: '/old.jpg',
        source: 'IGDB',
        externalId: 1036,
      }),
      enriched: enriched({ coverUrl: '/new.jpg' }),
    });
    expect(replaced).toMatchObject({ coverUrl: '/new.jpg' });

    const kept = buildReenrichmentUpdate({
      existing: existing({
        coverUrl: '/old.jpg',
        source: 'IGDB',
        externalId: 1036,
      }),
      enriched: enriched({ coverUrl: null, sourceCoverUrl: null }),
    });
    expect(kept).not.toHaveProperty('coverUrl');
  });

  it('stores the external source link when a fresh download failed', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({ source: 'IGDB', externalId: 1036 }),
      enriched: enriched({ coverUrl: null }),
    });

    expect(data).toMatchObject({
      sourceCoverUrl:
        'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
    });
    expect(data).not.toHaveProperty('coverUrl');
  });

  it('stores both the local cover and the external source link', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({ source: 'IGDB', externalId: 1036 }),
      enriched: enriched(),
    });

    expect(data).toMatchObject({
      coverUrl: '/api/covers/abc.jpg',
      sourceCoverUrl:
        'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
    });
  });

  it('clears the platform-unverified flag when otherwise unchanged', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: 16,
        summary: 'Halo is…',
        rating: 78.4,
        ratingCount: 512,
        coverUrl: '/api/covers/abc.jpg',
        sourceCoverUrl:
          'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
        source: 'IGDB',
        externalId: 1036,
        igdbSlug: 'halo-combat-evolved',
        platformUnverified: true,
      }),
      enriched: enriched(),
    });

    expect(data).toEqual({
      platformUnverified: false,
      rawMetadata: JSON.stringify({ id: 1036 }),
      enrichedAt: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('only appends rawMetadata and enrichedAt when a change occurs', () => {
    const noChange = buildReenrichmentUpdate({
      existing: existing({
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: 16,
        summary: 'Halo is…',
        rating: 78.4,
        ratingCount: 512,
        coverUrl: '/api/covers/abc.jpg',
        sourceCoverUrl:
          'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
        source: 'IGDB',
        externalId: 1036,
        igdbSlug: 'halo-combat-evolved',
      }),
      enriched: enriched(),
    });
    expect(noChange).toBeNull();

    const change = buildReenrichmentUpdate({
      existing: existing(),
      enriched: enriched(),
    });
    expect(change).toMatchObject({
      rawMetadata: JSON.stringify({ id: 1036 }),
      enrichedAt: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('replaces the gallery when the candidate supplies a different one', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({
        source: 'IGDB',
        externalId: 1036,
        images: [{ url: '/api/covers/old.jpg' }],
      }),
      enriched: enriched({
        images: [
          { url: '/api/covers/new1.jpg', sourceUrl: 'https://x/1.jpg' },
          { url: '/api/covers/new2.jpg', sourceUrl: null },
        ],
      }),
    });

    expect(data).toMatchObject({
      images: {
        deleteMany: {},
        create: [
          {
            position: 0,
            url: '/api/covers/new1.jpg',
            sourceUrl: 'https://x/1.jpg',
          },
          { position: 1, url: '/api/covers/new2.jpg', sourceUrl: null },
        ],
      },
    });
  });

  it('writes nothing when the candidate gallery order is identical', () => {
    const gallery = [
      { url: '/api/covers/g1.jpg' },
      { url: '/api/covers/g2.jpg' },
    ];
    const data = buildReenrichmentUpdate({
      existing: existing({
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: 16,
        summary: 'Halo is…',
        rating: 78.4,
        ratingCount: 512,
        coverUrl: '/api/covers/abc.jpg',
        sourceCoverUrl:
          'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
        source: 'IGDB',
        externalId: 1036,
        igdbSlug: 'halo-combat-evolved',
        images: gallery,
      }),
      enriched: enriched({
        images: gallery.map((image) => ({ ...image, sourceUrl: null })),
      }),
    });

    expect(data).toBeNull();
  });

  it('keeps the existing gallery when the candidate supplies none', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({
        source: 'IGDB',
        externalId: 1036,
        images: [{ url: '/api/covers/keep.jpg' }],
      }),
      enriched: enriched({ source: 'IGDB', externalId: 1036 }),
    });

    expect(data).not.toBeNull();
    expect(data).not.toHaveProperty('images');
  });

  it('never overwrites a hand-edited summary but still refreshes rating', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({
        source: 'IGDB',
        externalId: 1036,
        summary: 'Mine',
        rating: null,
        ratingCount: null,
      }),
      enriched: enriched({ summary: 'IGDB text', rating: 90, ratingCount: 10 }),
      editedFields: new Set(['summary']),
    });

    expect(data).not.toBeNull();
    expect(data).not.toHaveProperty('summary');
    expect(data).toMatchObject({ rating: 90, ratingCount: 10 });
  });

  it('updates a non-edited summary when the source text changed', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({ source: 'IGDB', externalId: 1036, summary: 'Old' }),
      enriched: enriched({ summary: 'New' }),
    });

    expect(data).toMatchObject({ summary: 'New' });
  });

  it('never wipes summary, rating or videos with null/empty candidate values', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({
        source: 'IGDB',
        externalId: 1036,
        summary: 'Keep me',
        rating: 78.4,
        ratingCount: 512,
        videos: [{ videoId: 'AbCdEfGhIj0', name: 'Trailer' }],
      }),
      enriched: enriched({
        summary: null,
        rating: null,
        ratingCount: null,
        videos: [],
      }),
    });

    expect(data).not.toBeNull();
    expect(data).not.toHaveProperty('summary');
    expect(data).not.toHaveProperty('rating');
    expect(data).not.toHaveProperty('ratingCount');
    expect(data).not.toHaveProperty('videos');
  });

  it('replaces videos when the order or a name differs', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({
        source: 'IGDB',
        externalId: 1036,
        videos: [{ videoId: 'AbCdEfGhIj0', name: 'Trailer' }],
      }),
      enriched: enriched({
        videos: [
          { videoId: 'Zyx_wvu-987', name: 'Gameplay' },
          { videoId: 'AbCdEfGhIj0', name: 'Trailer' },
        ],
      }),
    });

    expect(data).toMatchObject({
      videos: {
        deleteMany: {},
        create: [
          { position: 0, videoId: 'Zyx_wvu-987', name: 'Gameplay' },
          { position: 1, videoId: 'AbCdEfGhIj0', name: 'Trailer' },
        ],
      },
    });
  });

  it('writes nothing when the videos are identical', () => {
    const videos = [{ videoId: 'AbCdEfGhIj0', name: 'Trailer' }];
    const data = buildReenrichmentUpdate({
      existing: existing({
        releaseYear: 2001,
        publisher: 'Bungie',
        genre: 'Shooter',
        playerCount: 16,
        summary: 'Halo is…',
        rating: 78.4,
        ratingCount: 512,
        coverUrl: '/api/covers/abc.jpg',
        sourceCoverUrl:
          'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
        source: 'IGDB',
        externalId: 1036,
        igdbSlug: 'halo-combat-evolved',
        videos,
      }),
      enriched: enriched({ videos }),
    });

    expect(data).toBeNull();
  });

  it('tracks summary as a hand-editable metadata field', () => {
    expect(TRACKED_METADATA_FIELDS).toContain('summary');
  });
});
