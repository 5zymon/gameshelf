import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/rating.ts` — the `78/100` label shown on game cards and the
 * detail view (card 9.1).
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

const { formatRating } = await import('../src/lib/rating.ts');

test('formatRating: rounds a 0–100 rating to the nearest integer', () => {
  assert.equal(formatRating(78.4), '78/100');
  assert.equal(formatRating(78.5), '79/100');
  assert.equal(formatRating(0), '0/100');
  assert.equal(formatRating(100), '100/100');
});

test('formatRating: null, undefined and non-finite values have no label', () => {
  assert.equal(formatRating(null), null);
  assert.equal(formatRating(undefined), null);
  assert.equal(formatRating(Number.NaN), null);
  assert.equal(formatRating(Number.POSITIVE_INFINITY), null);
});

test('formatRating: clamps out-of-range values to [0, 100]', () => {
  assert.equal(formatRating(-5), '0/100');
  assert.equal(formatRating(150), '100/100');
});
