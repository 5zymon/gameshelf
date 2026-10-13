import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/platforms.ts` — the client-side default-view filter that
 * decides which platforms the `/platforms` list shows before the "show all"
 * toggle is flipped.
 *
 * The source is TypeScript with the `@/*` alias and extensionless relative
 * imports (Bundler resolution) that Node's ESM loader does not understand, so
 * we register a small `resolve` hook that maps `@/x` to `src/x` and appends
 * `.ts`/`/index.ts` to relative specifiers. The hook only touches those two
 * shapes; `node:` builtins and the `@gameshelf/contracts` workspace package
 * fall through to the default resolver.
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

const { inDefaultView, filterPlatforms } =
  await import('../src/lib/platforms.ts');

/** A full platform row; tests override only the fields under test. */
function platform(overrides = {}) {
  return {
    id: '01900000-0000-7000-8000-000000000001',
    name: 'Test Platform',
    igdbId: null,
    addedByImport: false,
    hidden: false,
    gameCount: 0,
    ...overrides,
  };
}

test('inDefaultView: a custom platform with zero games is visible (the fix)', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: null,
        addedByImport: false,
        hidden: false,
        gameCount: 0,
      }),
    ),
    true,
  );
});

test('inDefaultView: a custom platform with games is visible', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: null,
        addedByImport: false,
        hidden: false,
        gameCount: 3,
      }),
    ),
    true,
  );
});

test('inDefaultView: a reference platform with zero games is NOT visible', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: 555,
        addedByImport: false,
        hidden: false,
        gameCount: 0,
      }),
    ),
    false,
  );
});

test('inDefaultView: a reference platform with games is visible', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: 555,
        addedByImport: false,
        hidden: false,
        gameCount: 4,
      }),
    ),
    true,
  );
});

test('inDefaultView: a hidden custom platform with zero games is NOT visible', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: null,
        addedByImport: false,
        hidden: true,
        gameCount: 0,
      }),
    ),
    false,
  );
});

test('inDefaultView: a hidden reference platform with games is NOT visible', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: 555,
        addedByImport: false,
        hidden: true,
        gameCount: 7,
      }),
    ),
    false,
  );
});

test('inDefaultView: a hidden custom platform with games is still NOT visible', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: null,
        addedByImport: false,
        hidden: true,
        gameCount: 2,
      }),
    ),
    false,
  );
});

test('inDefaultView: an import row is visible even with zero games (unchanged)', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: null,
        addedByImport: true,
        hidden: false,
        gameCount: 0,
      }),
    ),
    true,
  );
});

test('inDefaultView: an import row stays visible even when hidden (addedByImport wins)', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: 555,
        addedByImport: true,
        hidden: true,
        gameCount: 0,
      }),
    ),
    true,
  );
});

test('inDefaultView: a sync-linked import row (igdbId set, not hidden) is visible', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: 555,
        addedByImport: true,
        hidden: false,
        gameCount: 0,
      }),
    ),
    true,
  );
});

test('inDefaultView: a hidden import row with no igdbId is visible (addedByImport wins)', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: null,
        addedByImport: true,
        hidden: true,
        gameCount: 0,
      }),
    ),
    true,
  );
});

test('inDefaultView: a hidden reference platform with zero games is NOT visible', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: 555,
        addedByImport: false,
        hidden: true,
        gameCount: 0,
      }),
    ),
    false,
  );
});

test('inDefaultView: an import row with games is visible', () => {
  assert.equal(
    inDefaultView(
      platform({
        igdbId: null,
        addedByImport: true,
        hidden: false,
        gameCount: 5,
      }),
    ),
    true,
  );
});

test('inDefaultView: custom-with-zero-games is the case that differs from a reference-with-zero-games', () => {
  const customZero = platform({ igdbId: null, gameCount: 0 });
  const referenceZero = platform({ igdbId: 555, gameCount: 0 });
  assert.equal(inDefaultView(customZero), true);
  assert.equal(inDefaultView(referenceZero), false);
});

test('filterPlatforms: with showAll=false it keeps only default-view rows', () => {
  const all = [
    platform({ id: 1, igdbId: null, gameCount: 0 }), // custom-0 → visible
    platform({ id: 2, igdbId: 555, gameCount: 0 }), // ref-0 → hidden
    platform({ id: 3, igdbId: 556, gameCount: 4 }), // ref-games → visible
    platform({ id: 4, igdbId: null, hidden: true, gameCount: 0 }), // hidden custom → hidden
    platform({ id: 5, addedByImport: true, gameCount: 0 }), // import → visible
  ];
  const visible = filterPlatforms(all, false);
  assert.deepEqual(
    visible.map((p) => p.id),
    [1, 3, 5],
  );
  assert.notEqual(visible, all, 'must return a new array, not the input');
});

test('filterPlatforms: with showAll=true it returns every row in order', () => {
  const all = [
    platform({ id: 1, igdbId: null, gameCount: 0 }),
    platform({ id: 2, igdbId: 555, gameCount: 0 }),
    platform({ id: 3, igdbId: 556, gameCount: 4 }),
    platform({ id: 4, igdbId: null, hidden: true, gameCount: 0 }),
    platform({ id: 5, addedByImport: true, gameCount: 0 }),
  ];
  const visible = filterPlatforms(all, true);
  assert.deepEqual(
    visible.map((p) => p.id),
    [1, 2, 3, 4, 5],
  );
  assert.notEqual(visible, all, 'must return a copy, not the input reference');
});

test('filterPlatforms: an empty catalog stays empty under either toggle', () => {
  assert.deepEqual(filterPlatforms([], false), []);
  assert.deepEqual(filterPlatforms([], true), []);
});
