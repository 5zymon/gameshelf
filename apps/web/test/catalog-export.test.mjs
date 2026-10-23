import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/catalog-export.ts` — the platform list and download URL of
 * the `/export` form.
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

const { exportPlatforms, exportCsvHref } =
  await import('../src/lib/catalog-export.ts');

/** A full platform row; tests override only the fields under test. */
function platform(overrides = {}) {
  return {
    id: '01900000-0000-7000-8000-000000000001',
    slug: 'test-platform',
    name: 'Test Platform',
    igdbId: null,
    addedByImport: false,
    hidden: false,
    gameCount: 0,
    ...overrides,
  };
}

test('exportCsvHref: no id is the whole-catalog URL', () => {
  assert.equal(exportCsvHref(), '/api/export/csv');
});

test('exportCsvHref: an id becomes the platformId query, URL-encoded', () => {
  assert.equal(
    exportCsvHref('01900000-0000-7000-8000-000000000001'),
    '/api/export/csv?platformId=01900000-0000-7000-8000-000000000001',
  );
  assert.equal(
    exportCsvHref('a&b=c d'),
    '/api/export/csv?platformId=a%26b%3Dc%20d',
  );
});

test('exportPlatforms: keeps default-view platforms in API order', () => {
  const result = exportPlatforms([
    platform({ id: 'a', name: 'Import', addedByImport: true }),
    platform({ id: 'b', name: 'Custom', igdbId: null, gameCount: 0 }),
    platform({ id: 'c', name: 'Reference', igdbId: 7, gameCount: 4 }),
  ]);
  assert.deepEqual(
    result.map((p) => p.id),
    ['a', 'b', 'c'],
  );
});

test('exportPlatforms: includes a custom or import platform with no games', () => {
  const result = exportPlatforms([
    platform({ id: 'a', addedByImport: true, gameCount: 0 }),
    platform({ id: 'b', igdbId: null, gameCount: 0 }),
  ]);
  assert.deepEqual(
    result.map((p) => [p.id, p.gameCount]),
    [
      ['a', 0],
      ['b', 0],
    ],
  );
});

test('exportPlatforms: drops an empty reference platform and a hidden one', () => {
  const result = exportPlatforms([
    platform({ id: 'a', igdbId: 7, gameCount: 0 }),
    platform({ id: 'b', igdbId: 8, hidden: true, gameCount: 3 }),
    platform({ id: 'c', igdbId: 9, gameCount: 2 }),
  ]);
  assert.deepEqual(
    result.map((p) => p.id),
    ['c'],
  );
});

test('exportPlatforms: returns only id, name and gameCount', () => {
  const [only] = exportPlatforms([
    platform({ id: 'a', name: 'SNES', igdbId: 19, gameCount: 5 }),
  ]);
  assert.deepEqual(only, { id: 'a', name: 'SNES', gameCount: 5 });
});
