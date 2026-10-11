import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/youtube.ts` — the id validation and embed-URL builder behind
 * the game-detail Videos player (card 9.1). The player must never receive a
 * malformed id, so the pure helpers are the security boundary here.
 *
 * The source is TypeScript with the `@/*` alias and extensionless relative
 * imports (Bundler resolution) that Node's ESM loader does not understand, so
 * we register a small `resolve` hook that maps `@/x` to `src/x` and appends
 * `.ts`/`/index.ts` to relative specifiers (same pattern as
 * `re-enrich.test.mjs`).
 */
const SRC_BASE = new URL('../src/', import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    let candidates = null;
    if (specifier.startsWith('@/')) {
      const rel = specifier.slice(2);
      candidates = [
        new URL(`${rel}.ts`, SRC_BASE),
        new URL(`${rel}/index.ts`, SRC_BASE),
      ];
    } else if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      context.parentURL
    ) {
      const dir = new URL('.', context.parentURL);
      candidates = [
        new URL(`${specifier}.ts`, dir),
        new URL(`${specifier}/index.ts`, dir),
      ];
    }
    if (candidates) {
      for (const candidate of candidates) {
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { isYoutubeVideoId, youtubeEmbedUrl, playableVideos } =
  await import('../src/lib/youtube.ts');

test('isYoutubeVideoId: accepts exactly 11 id characters', () => {
  assert.equal(isYoutubeVideoId('dQw4w9WgXcQ'), true);
  assert.equal(isYoutubeVideoId('_-abcdefghi'), true);
});

test('isYoutubeVideoId: rejects wrong length or unsafe characters', () => {
  assert.equal(isYoutubeVideoId(''), false);
  assert.equal(isYoutubeVideoId('short'), false);
  assert.equal(isYoutubeVideoId('dQw4w9WgXcQ!'), false);
  assert.equal(isYoutubeVideoId('dQw4w9WgXc$'), false);
  assert.equal(isYoutubeVideoId('dQw4w9Wg cQ'), false);
});

test('youtubeEmbedUrl: builds the embed URL, optionally autoplaying', () => {
  assert.equal(
    youtubeEmbedUrl('dQw4w9WgXcQ'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
  );
  assert.equal(
    youtubeEmbedUrl('dQw4w9WgXcQ', true),
    'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1',
  );
});

test('youtubeEmbedUrl: an invalid id never yields a URL', () => {
  assert.equal(youtubeEmbedUrl('bad'), null);
  assert.equal(youtubeEmbedUrl(''), null);
});

test('playableVideos: keeps valid ids in order and drops the rest', () => {
  const videos = [
    { videoId: 'dQw4w9WgXcQ', name: 'Trailer' },
    { videoId: 'nope', name: 'Broken' },
    { videoId: 'M7lc1UVf-VE', name: 'Gameplay' },
  ];

  assert.deepEqual(playableVideos(videos), [
    { videoId: 'dQw4w9WgXcQ', name: 'Trailer' },
    { videoId: 'M7lc1UVf-VE', name: 'Gameplay' },
  ]);
});
