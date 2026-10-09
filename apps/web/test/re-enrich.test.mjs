import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/re-enrich.ts` — the pure selection helpers behind the
 * `ReEnrichControl` candidate radio group (which candidate is selected by
 * default, and how the picked key resolves back to a candidate).
 *
 * The source is TypeScript with the `@/*` alias and extensionless relative
 * imports (Bundler resolution) that Node's ESM loader does not understand, so
 * we register a small `resolve` hook that maps `@/x` to `src/x` and appends
 * `.ts`/`/index.ts` to relative specifiers (same pattern as
 * `platforms.test.mjs`).
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

const { candidateKey, initialSelection, findSelectedCandidate } =
  await import('../src/lib/re-enrich.ts');

/** A candidate; tests override only the fields under test. */
function candidate(overrides = {}) {
  return {
    externalId: 1036,
    title: 'Halo: Combat Evolved',
    releaseYear: 2001,
    publisher: 'Bungie',
    genre: 'Shooter',
    playerCount: 16,
    coverUrl: '/api/covers/preview?u=b64&s=sig',
    platforms: [{ igdbId: 11, name: 'Xbox', abbreviation: 'XBOX' }],
    source: 'IGDB',
    ...overrides,
  };
}

test('candidateKey: stable source + externalId identity', () => {
  assert.equal(candidateKey(candidate()), 'IGDB:1036');
  assert.equal(
    candidateKey(candidate({ source: 'MobyGames' })),
    'MobyGames:1036',
  );
});

test('initialSelection: an empty list has no selection', () => {
  assert.equal(initialSelection([]), null);
});

test('initialSelection: defaults to the top-ranked candidate', () => {
  const first = candidate();
  const second = candidate({ externalId: 2222, title: 'Halo 2' });
  assert.equal(initialSelection([first, second]), 'IGDB:1036');
});

test('findSelectedCandidate: resolves the matching candidate by key', () => {
  const first = candidate();
  const second = candidate({ externalId: 2222, title: 'Halo 2' });
  assert.equal(findSelectedCandidate([first, second], 'IGDB:2222'), second);
});

test('findSelectedCandidate: null or an absent key resolves to undefined', () => {
  const first = candidate();
  assert.equal(findSelectedCandidate([first], null), undefined);
  assert.equal(findSelectedCandidate([first], 'IGDB:999'), undefined);
  assert.equal(findSelectedCandidate([], 'IGDB:1036'), undefined);
});
