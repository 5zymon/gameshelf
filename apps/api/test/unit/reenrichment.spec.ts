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

function existing(
  overrides: Partial<ReenrichmentExisting> = {},
): ReenrichmentExisting {
  return {
    id: 1,
    releaseYear: null,
    publisher: null,
    genre: null,
    playerCount: null,
    coverUrl: null,
    sourceCoverUrl: null,
    rawMetadata: null,
    source: 'MANUAL',
    externalId: null,
    platformUnverified: false,
    userEditedFields: null,
    ...overrides,
  };
}

function enriched(overrides: Partial<EnrichedGameData> = {}): EnrichedGameData {
  return {
    title: 'Halo: Combat Evolved',
    platformId: 3,
    edition: null,
    releaseYear: 2001,
    publisher: 'Bungie',
    genre: 'Shooter',
    playerCount: 16,
    coverUrl: '/api/covers/abc.jpg',
    sourceCoverUrl:
      'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
    rawMetadata: JSON.stringify({ id: 1036 }),
    enrichedAt: new Date('2026-10-07T00:00:00.000Z'),
    source: 'IGDB',
    externalId: 1036,
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
        coverUrl: '/api/covers/abc.jpg',
        sourceCoverUrl:
          'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
        source: 'IGDB',
        externalId: 1036,
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
      coverUrl: '/api/covers/abc.jpg',
      sourceCoverUrl:
        'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
      source: 'IGDB',
      externalId: 1036,
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
        coverUrl: '/old.jpg',
        source: 'MobyGames',
        externalId: 7,
      }),
      enriched: enriched({
        releaseYear: null,
        publisher: null,
        genre: null,
        playerCount: null,
        coverUrl: null,
        sourceCoverUrl: null,
        source: 'IGDB',
        externalId: 7,
      }),
    });

    // Only the source changed; every candidate-null field is left untouched.
    expect(data).toEqual({
      source: 'IGDB',
      rawMetadata: JSON.stringify({ id: 1036 }),
      enrichedAt: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('never emits title, platformId, or edition', () => {
    const data = buildReenrichmentUpdate({
      existing: existing({ source: 'IGDB', externalId: 1036 }),
      enriched: enriched({
        title: 'Different Title',
        platformId: 99,
        edition: 'GOTY',
      }),
    });

    expect(data).not.toBeNull();
    expect(data).not.toHaveProperty('title');
    expect(data).not.toHaveProperty('platformId');
    expect(data).not.toHaveProperty('edition');
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
        coverUrl: '/api/covers/abc.jpg',
        sourceCoverUrl:
          'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
        source: 'IGDB',
        externalId: 1036,
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
        coverUrl: '/api/covers/abc.jpg',
        sourceCoverUrl:
          'https://images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
        source: 'IGDB',
        externalId: 1036,
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
});
