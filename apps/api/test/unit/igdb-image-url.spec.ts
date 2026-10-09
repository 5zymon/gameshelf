import { igdbImageUrl } from '../../src/game-catalog/igdb-image-url';

describe('igdbImageUrl (unit)', () => {
  it('makes a protocol-relative URL absolute and applies the size', () => {
    expect(
      igdbImageUrl(
        '//images.igdb.com/igdb/image/upload/t_thumb/co61gh.jpg',
        't_1080p',
      ),
    ).toBe('https://images.igdb.com/igdb/image/upload/t_1080p/co61gh.jpg');
  });

  it('replaces an existing size segment', () => {
    expect(
      igdbImageUrl(
        'https://images.igdb.com/igdb/image/upload/t_original/co61gh.jpg',
        't_1080p',
      ),
    ).toBe('https://images.igdb.com/igdb/image/upload/t_1080p/co61gh.jpg');
    expect(
      igdbImageUrl(
        'https://images.igdb.com/igdb/image/upload/t_cover_big/co61gh.jpg',
        't_1080p',
      ),
    ).toBe('https://images.igdb.com/igdb/image/upload/t_1080p/co61gh.jpg');
  });

  it('inserts a size segment when the URL has none', () => {
    expect(
      igdbImageUrl(
        'https://images.igdb.com/igdb/image/upload/co61gh.jpg',
        't_1080p',
      ),
    ).toBe('https://images.igdb.com/igdb/image/upload/t_1080p/co61gh.jpg');
  });

  it('returns null for null, empty, and whitespace-only input', () => {
    expect(igdbImageUrl(null, 't_1080p')).toBeNull();
    expect(igdbImageUrl(undefined, 't_1080p')).toBeNull();
    expect(igdbImageUrl('', 't_1080p')).toBeNull();
    expect(igdbImageUrl('   ', 't_1080p')).toBeNull();
  });

  it('is idempotent for an already-sized URL', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_1080p/co61gh.jpg';
    expect(igdbImageUrl(url, 't_1080p')).toBe(url);
  });

  it('returns a non-IGDB-transform URL unchanged', () => {
    const url = 'https://cdn.example.com/covers/halo.jpg';
    expect(igdbImageUrl(url, 't_1080p')).toBe(url);
  });
});
