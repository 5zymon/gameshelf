import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/import/upload-status.ts` — the pure helper that turns the
 * XHR upload progress (plus the "server accepted the batch" flag) into the
 * phase the /import submit UI shows: an unmeasured upload, a floored
 * percentage, or the server-side wait after every byte is sent.
 *
 * The source is TypeScript with the `@/*` alias and extensionless relative
 * imports (Bundler resolution) that Node's ESM loader does not understand, so
 * we register the same small `resolve` hook as `import-progress.test.mjs`.
 * `upload-status.ts` imports only a type, which Node strips.
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

const { uploadStatus } = await import('../src/lib/import/upload-status.ts');

test('no progress event yet: the amount is unknown', () => {
  assert.deepEqual(uploadStatus(null, false), {
    phase: 'uploading',
    percent: null,
  });
});

test('a non-positive total cannot produce a percentage', () => {
  assert.deepEqual(uploadStatus({ loaded: 0, total: 0 }, false), {
    phase: 'uploading',
    percent: null,
  });
});

test('bytes in flight: the percentage is loaded over total', () => {
  assert.deepEqual(uploadStatus({ loaded: 250, total: 1000 }, false), {
    phase: 'uploading',
    percent: 25,
  });
});

test('the percentage is floored, so 100% never shows in flight', () => {
  assert.deepEqual(uploadStatus({ loaded: 999, total: 1000 }, false), {
    phase: 'uploading',
    percent: 99,
  });
});

test('every byte sent: the wait is server-side and reads as starting', () => {
  assert.deepEqual(uploadStatus({ loaded: 1000, total: 1000 }, false), {
    phase: 'starting',
  });
});

test('an over-reported loaded count still reads as starting', () => {
  assert.deepEqual(uploadStatus({ loaded: 1200, total: 1000 }, false), {
    phase: 'starting',
  });
});

test('an accepted batch reads as starting regardless of progress', () => {
  assert.deepEqual(uploadStatus(null, true), { phase: 'starting' });
  assert.deepEqual(uploadStatus({ loaded: 10, total: 1000 }, true), {
    phase: 'starting',
  });
});
