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

/** Deterministic valid UUIDv7 fixtures; lexical order follows n. */
const testId = (n) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ID_A = testId(1);
const ID_B = testId(2);
const ID_C = testId(3);
const ID_D = testId(4);
/** A valid UUIDv4: the right shape, the wrong version. */
const UUID_V4 = '6f1c2e44-3b0a-4c2e-9d1f-0a1b2c3d4e5f';
/** An id with hex letters, so case-insensitivity is observable. */
const ID_MIXED = '0190000a-000b-7c00-8d00-00000000e0f1';

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
  assert.equal(hasActiveFilters({ platformId: [ID_A] }), true);
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
    platformId: [ID_A],
    year: 2024,
    sort: 'year',
    order: 'desc',
  });
  assert.equal(href, `/?platformId=${ID_A}&year=2024&sort=year&order=desc`);
  assert.equal(href.includes('page'), false);
});

test('parseCatalogFilters: a single platformId parses to a one-element array', () => {
  assert.deepEqual(parseCatalogFilters({ platformId: ID_A }), {
    platformId: [ID_A],
  });
});

test('parseCatalogFilters: repeated platformIds are de-duplicated and lexicographic', () => {
  assert.deepEqual(
    parseCatalogFilters({ platformId: [ID_B, ID_A, ID_B, ID_A] }),
    { platformId: [ID_A, ID_B] },
  );
});

test('parseCatalogFilters: case-insensitive ids collapse onto the lowercase form', () => {
  assert.notEqual(ID_MIXED.toUpperCase(), ID_MIXED);
  assert.deepEqual(
    parseCatalogFilters({ platformId: [ID_MIXED.toUpperCase(), ID_MIXED] }),
    { platformId: [ID_MIXED] },
  );
});

test('parseCatalogFilters: invalid platformId entries are dropped one at a time', () => {
  assert.deepEqual(
    parseCatalogFilters({
      platformId: ['0', 'abc', ID_C, UUID_V4, '', ` ${ID_D} `],
    }),
    { platformId: [ID_C, ID_D] },
  );
  assert.deepEqual(parseCatalogFilters({ platformId: ['0', 'x'] }), {});
});

test('parseCatalogFilters: more than 100 platformIds keep the 100 lexically smallest', () => {
  assert.equal(MAX_PLATFORM_IDS, 100);
  // Reversed input: canonicalisation sorts before it caps.
  const ids = Array.from({ length: 101 }, (_, i) => testId(101 - i));
  const parsed = parseCatalogFilters({ platformId: ids });
  assert.equal(parsed.platformId.length, 100);
  assert.equal(parsed.platformId[99], testId(100));
  assert.equal(parsed.platformId.includes(testId(101)), false);
});

test('catalogHref: repeated platformIds are canonical (lexicographic, de-duplicated)', () => {
  assert.equal(
    catalogHref({ platformId: [ID_B, ID_A, ID_B] }),
    `/?platformId=${ID_A}&platformId=${ID_B}`,
  );
  assert.equal(catalogHref({ platformId: [] }), '/');
});

test('catalogHref: a multi-platform selection survives a getAll → parse round trip', () => {
  const href = catalogHref({ platformId: [ID_B, ID_A], q: 'x' });
  const search = new URLSearchParams(href.slice(2));
  const parsed = parseCatalogFilters({
    platformId: search.getAll('platformId'),
    q: search.get('q'),
  });
  assert.deepEqual(parsed, { platformId: [ID_A, ID_B], q: 'x' });
});

test('togglePlatformId: adds when absent, removes when present', () => {
  assert.deepEqual(togglePlatformId(undefined, ID_A), [ID_A]);
  assert.deepEqual(togglePlatformId([ID_A], ID_B), [ID_A, ID_B]);
  assert.deepEqual(togglePlatformId([ID_A, ID_B], ID_A), [ID_B]);
  assert.equal(togglePlatformId([ID_A], ID_A), undefined);
});

test('removePlatformId: removes (idempotent), the last removal yields undefined', () => {
  assert.deepEqual(removePlatformId([ID_A, ID_B], ID_B), [ID_A]);
  assert.deepEqual(removePlatformId([ID_A], ID_D), [ID_A]);
  assert.equal(removePlatformId([ID_A], ID_A), undefined);
  assert.equal(removePlatformId(undefined, ID_A), undefined);
});

test('togglePlatformId/removePlatformId: an uppercase id matches its lowercase entry', () => {
  assert.notEqual(ID_MIXED.toUpperCase(), ID_MIXED);
  assert.deepEqual(togglePlatformId(undefined, ID_MIXED.toUpperCase()), [
    ID_MIXED,
  ]);
  assert.equal(togglePlatformId([ID_MIXED], ID_MIXED.toUpperCase()), undefined);
  assert.equal(removePlatformId([ID_MIXED], ID_MIXED.toUpperCase()), undefined);
  assert.deepEqual(removePlatformId([ID_A, ID_MIXED], ID_MIXED.toUpperCase()), [
    ID_A,
  ]);
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

test('parseCatalogFilters: yearFrom/yearTo accept 1000–2100 and drop the rest', () => {
  assert.deepEqual(parseCatalogFilters({ yearFrom: '1990', yearTo: '1999' }), {
    yearFrom: 1990,
    yearTo: 1999,
  });
  assert.deepEqual(parseCatalogFilters({ yearFrom: '1000', yearTo: '2100' }), {
    yearFrom: 1000,
    yearTo: 2100,
  });
  assert.deepEqual(
    parseCatalogFilters({
      yearFrom: '999',
      yearTo: '2101',
    }),
    {},
  );
  assert.deepEqual(parseCatalogFilters({ yearFrom: 'abc', yearTo: '' }), {});
  assert.deepEqual(parseCatalogFilters({ yearFrom: ['1990', '2000'] }), {
    yearFrom: 1990,
  });
});

test('parseCatalogFilters: noYear/platformUnverified are kept only as the literal true', () => {
  assert.deepEqual(parseCatalogFilters({ noYear: 'true' }), { noYear: true });
  assert.deepEqual(parseCatalogFilters({ platformUnverified: 'true' }), {
    platformUnverified: true,
  });
  for (const raw of ['false', '1', '', 'TRUE', 'yes']) {
    assert.deepEqual(
      parseCatalogFilters({ noYear: raw, platformUnverified: raw }),
      {},
    );
  }
  assert.deepEqual(parseCatalogFilters({ noYear: ['false', 'true'] }), {});
});

test('hasActiveFilters: each new key activates', () => {
  assert.equal(hasActiveFilters({ yearFrom: 1990 }), true);
  assert.equal(hasActiveFilters({ yearTo: 1999 }), true);
  assert.equal(hasActiveFilters({ noYear: true }), true);
  assert.equal(hasActiveFilters({ platformUnverified: true }), true);
});

test('catalogHref: the stats link shapes', () => {
  assert.equal(catalogHref({ platformId: [ID_A] }), `/?platformId=${ID_A}`);
  assert.equal(
    catalogHref({ yearFrom: 1990, yearTo: 1999 }),
    '/?yearFrom=1990&yearTo=1999',
  );
  assert.equal(catalogHref({ noYear: true }), '/?noYear=true');
  assert.equal(
    catalogHref({ platformUnverified: true }),
    '/?platformUnverified=true',
  );
  assert.equal(catalogHref({ noYear: undefined, yearFrom: undefined }), '/');
});

test('catalogHref: the new filters survive a build → parse round trip', () => {
  const values = {
    year: 1995,
    yearFrom: 1990,
    yearTo: 1999,
    noYear: true,
    platformUnverified: true,
  };
  const qs = catalogHref(values).slice(2);
  assert.deepEqual(
    parseCatalogFilters(Object.fromEntries(new URLSearchParams(qs))),
    values,
  );
});
