import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/catalog-filters.ts` — the URL is the source of truth for the
 * catalog filter bar (ticket 5.3 + the filter-bar redesign): parsing/whitelisting
 * the 7 filter params plus the `sort`/`order` pair, `hasActiveFilters` ignoring
 * sort, and the `catalogHref` / `sortOverrides` / `sortOptionOf` round trip.
 *
 * The source is TypeScript with the `@/*` alias and extensionless relative
 * imports (Bundler resolution) that Node's ESM loader does not understand, so
 * we register a small `resolve` hook that maps `@/x` to `src/x` and appends
 * `.ts`/`/index.ts` to relative specifiers (copied from `platforms.test.mjs`).
 * The source's only import is `import type`, which Node type-stripping erases.
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

const {
  SORT_OPTIONS,
  MAX_PLATFORM_IDS,
  canonicalPlatformIds,
  catalogHref,
  hasActiveFilters,
  parseCatalogFilters,
  removePlatformId,
  sortOptionOf,
  sortOverrides,
  togglePlatformId,
} = await import('../src/lib/catalog-filters.ts');

test('parseCatalogFilters: empty params parse to no values', () => {
  assert.deepEqual(parseCatalogFilters({}), {});
});

test('parseCatalogFilters: the default sort is omitted', () => {
  assert.deepEqual(parseCatalogFilters({ sort: 'title' }), {});
  assert.deepEqual(parseCatalogFilters({ sort: 'title', order: 'asc' }), {});
});

test('parseCatalogFilters: a non-default title order is kept', () => {
  assert.deepEqual(parseCatalogFilters({ sort: 'title', order: 'desc' }), {
    sort: 'title',
    order: 'desc',
  });
});

test('parseCatalogFilters: year defaults to asc', () => {
  assert.deepEqual(parseCatalogFilters({ sort: 'year', order: 'desc' }), {
    sort: 'year',
    order: 'desc',
  });
  assert.deepEqual(parseCatalogFilters({ sort: 'year' }), {
    sort: 'year',
    order: 'asc',
  });
});

test('parseCatalogFilters: unsupported sort fields and a lone order are dropped', () => {
  assert.deepEqual(parseCatalogFilters({ sort: 'platform' }), {});
  assert.deepEqual(parseCatalogFilters({ sort: 'createdAt' }), {});
  assert.deepEqual(parseCatalogFilters({ sort: 'x' }), {});
  assert.deepEqual(parseCatalogFilters({ order: 'desc' }), {});
});

test('parseCatalogFilters: an unknown order falls back to asc', () => {
  assert.deepEqual(parseCatalogFilters({ sort: 'year', order: 'sideways' }), {
    sort: 'year',
    order: 'asc',
  });
});

test('parseCatalogFilters: array params take the first value', () => {
  assert.deepEqual(
    parseCatalogFilters({ sort: ['year', 'title'], order: ['desc'] }),
    { sort: 'year', order: 'desc' },
  );
});

test('hasActiveFilters: sort alone is not a filter', () => {
  assert.equal(hasActiveFilters({ sort: 'year', order: 'desc' }), false);
  assert.equal(hasActiveFilters({ platformId: [2] }), true);
  assert.equal(hasActiveFilters({ platformId: [] }), false);
});

test('catalogHref: sort/order are written and page is always dropped', () => {
  assert.equal(
    catalogHref({ q: 'zelda', sort: 'year', order: 'desc' }),
    '/?q=zelda&sort=year&order=desc',
  );
  assert.equal(catalogHref({}), '/');
  assert.equal(catalogHref({ sort: 'year' }).includes('page'), false);
});

test('catalogHref: several params serialise together and page is dropped', () => {
  const href = catalogHref({
    platformId: [232],
    year: 2024,
    sort: 'year',
    order: 'desc',
  });
  assert.equal(href, '/?platformId=232&year=2024&sort=year&order=desc');
  assert.equal(href.includes('page'), false);
});

test('parseCatalogFilters: a single platformId parses to a one-element array', () => {
  assert.deepEqual(parseCatalogFilters({ platformId: '232' }), {
    platformId: [232],
  });
});

test('parseCatalogFilters: repeated platformIds are de-duplicated and ascending', () => {
  assert.deepEqual(parseCatalogFilters({ platformId: ['5', '2', '5'] }), {
    platformId: [2, 5],
  });
});

test('parseCatalogFilters: invalid platformId entries are dropped one at a time', () => {
  assert.deepEqual(
    parseCatalogFilters({ platformId: ['0', 'abc', '3', '-1', '', ' 4 '] }),
    { platformId: [3, 4] },
  );
  assert.deepEqual(parseCatalogFilters({ platformId: ['0', 'x'] }), {});
  assert.deepEqual(parseCatalogFilters({ platformId: ['2147483648', '3'] }), {
    platformId: [3],
  });
  assert.deepEqual(parseCatalogFilters({ platformId: ['2147483648'] }), {});
});

test('parseCatalogFilters: more than 100 platformIds keep the 100 smallest', () => {
  assert.equal(MAX_PLATFORM_IDS, 100);
  const ids = Array.from({ length: 101 }, (_, i) => String(i + 1));
  const parsed = parseCatalogFilters({ platformId: ids });
  assert.equal(parsed.platformId.length, 100);
  assert.equal(parsed.platformId[99], 100);
});

test('catalogHref: repeated platformIds are canonical (ascending, de-duplicated)', () => {
  assert.equal(
    catalogHref({ platformId: [5, 2, 5] }),
    '/?platformId=2&platformId=5',
  );
  assert.equal(catalogHref({ platformId: [] }), '/');
});

test('catalogHref: a multi-platform selection survives a getAll → parse round trip', () => {
  const href = catalogHref({ platformId: [3, 1], q: 'x' });
  const search = new URLSearchParams(href.slice(2));
  const parsed = parseCatalogFilters({
    platformId: search.getAll('platformId'),
    q: search.get('q'),
  });
  assert.deepEqual(parsed, { platformId: [1, 3], q: 'x' });
});

test('togglePlatformId: adds when absent, removes when present', () => {
  assert.deepEqual(togglePlatformId(undefined, 4), [4]);
  assert.deepEqual(togglePlatformId([4], 2), [2, 4]);
  assert.deepEqual(togglePlatformId([2, 4], 2), [4]);
  assert.equal(togglePlatformId([4], 4), undefined);
});

test('removePlatformId: removes (idempotent), the last removal yields undefined', () => {
  assert.deepEqual(removePlatformId([1, 2], 2), [1]);
  assert.deepEqual(removePlatformId([1], 9), [1]);
  assert.equal(removePlatformId([1], 1), undefined);
  assert.equal(removePlatformId(undefined, 1), undefined);
});

test('sortOverrides: the default clears both keys, others split', () => {
  assert.deepEqual(sortOverrides('title-asc'), {
    sort: undefined,
    order: undefined,
  });
  assert.deepEqual(sortOverrides('year-desc'), {
    sort: 'year',
    order: 'desc',
  });
});

test('sortOptionOf: empty values and non-default values map to options', () => {
  assert.equal(sortOptionOf({}), 'title-asc');
  assert.equal(sortOptionOf({ sort: 'title', order: 'desc' }), 'title-desc');
});

test('sortOptionOf: an inconsistent pair falls back to the default option', () => {
  // A lone `sort` is completed with the default `asc` order, and `year-asc` is a
  // valid option — the fallback only fires for a pair absent from SORT_OPTIONS.
  assert.equal(sortOptionOf({ sort: 'year' }), 'year-asc');
  assert.equal(sortOptionOf({ sort: 'year', order: 'sideways' }), 'title-asc');
});

test('every sort option survives a catalogHref → parse → sortOptionOf round trip', () => {
  for (const option of SORT_OPTIONS) {
    const qs = catalogHref(sortOverrides(option)).slice(2);
    const parsed = parseCatalogFilters(
      Object.fromEntries(new URLSearchParams(qs)),
    );
    assert.equal(sortOptionOf(parsed), option);
  }
});
