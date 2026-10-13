import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/uuid.ts` — the shared UUIDv7 shape check that mirrors the
 * API's `@IsUUID('7')` (RFC 9562, any case).
 *
 * The source is TypeScript with the `@/*` alias and extensionless relative
 * imports (Bundler resolution) that Node's ESM loader does not understand, so
 * we register a small `resolve` hook that maps `@/x` to `src/x` and appends
 * `.ts`/`/index.ts` to relative specifiers (copied from
 * `catalog-filters.test.mjs`).
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

const { isUuidV7 } = await import('../src/lib/uuid.ts');

const LOWER = '0190000a-000b-7c00-8d00-00000000e0f1';
/** A valid UUIDv4: the right shape, the wrong version. */
const UUID_V4 = '6f1c2e44-3b0a-4c2e-9d1f-0a1b2c3d4e5f';

test('isUuidV7: accepts a lowercase v7', () => {
  assert.equal(isUuidV7(LOWER), true);
});

test('isUuidV7: accepts an uppercase v7 (the API validator is case-insensitive)', () => {
  assert.notEqual(LOWER.toUpperCase(), LOWER);
  assert.equal(isUuidV7(LOWER.toUpperCase()), true);
});

test('isUuidV7: rejects a v4', () => {
  assert.equal(isUuidV7(UUID_V4), false);
});

test('isUuidV7: rejects empty, numeric and truncated strings', () => {
  assert.equal(isUuidV7(''), false);
  assert.equal(isUuidV7('123'), false);
  assert.equal(isUuidV7(LOWER.slice(0, 35)), false);
});
