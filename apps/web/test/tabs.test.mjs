import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/tabs.ts` — the pure roving-focus helper behind the detail
 * page's About/Media tablist. The `Tabs` component itself (DOM, ARIA, focus)
 * needs a React/DOM runner the web app does not have, so only the key-to-index
 * mapping is unit-tested here.
 *
 * The source is TypeScript with the `@/*` alias and extensionless relative
 * imports (Bundler resolution) that Node's ESM loader does not understand, so
 * we register the same small `resolve` hook as `youtube.test.mjs`.
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

const { nextTabIndex } = await import('../src/lib/tabs.ts');

test('nextTabIndex: ArrowRight/ArrowLeft move one tab and wrap', () => {
  assert.equal(nextTabIndex(0, 'ArrowRight', 2), 1);
  assert.equal(nextTabIndex(1, 'ArrowRight', 2), 0);
  assert.equal(nextTabIndex(0, 'ArrowLeft', 2), 1);
  assert.equal(nextTabIndex(1, 'ArrowLeft', 2), 0);
});

test('nextTabIndex: Home/End jump to the first/last tab', () => {
  assert.equal(nextTabIndex(1, 'Home', 2), 0);
  assert.equal(nextTabIndex(0, 'End', 2), 1);
});

test('nextTabIndex: three tabs move one step, wrap, and jump', () => {
  assert.equal(nextTabIndex(0, 'ArrowRight', 3), 1);
  assert.equal(nextTabIndex(1, 'ArrowLeft', 3), 0);
  assert.equal(nextTabIndex(0, 'ArrowLeft', 3), 2);
  assert.equal(nextTabIndex(2, 'ArrowRight', 3), 0);
  assert.equal(nextTabIndex(2, 'Home', 3), 0);
  assert.equal(nextTabIndex(0, 'End', 3), 2);
});

test('nextTabIndex: a single tab stays on itself', () => {
  assert.equal(nextTabIndex(0, 'ArrowRight', 1), 0);
});

test('nextTabIndex: unrelated keys are not handled', () => {
  assert.equal(nextTabIndex(0, 'Enter', 2), null);
  assert.equal(nextTabIndex(0, 'a', 2), null);
  assert.equal(nextTabIndex(0, 'ArrowDown', 2), null);
});

test('nextTabIndex: an empty tablist is not handled', () => {
  assert.equal(nextTabIndex(0, 'ArrowRight', 0), null);
  assert.equal(nextTabIndex(0, 'Home', 0), null);
});
