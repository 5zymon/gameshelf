import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/id.ts` — the client-side id helper used by the photo import
 * form.
 *
 * The source is TypeScript with the `@/*` alias and extensionless relative
 * imports (Bundler resolution) that Node's ESM loader does not understand, so
 * we register a small `resolve` hook that maps `@/x` to `src/x` and appends
 * `.ts`/`/index.ts` to relative specifiers (same pattern as
 * `rating.test.mjs`).
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

const { createClientId, randomClientId } = await import('../src/lib/id.ts');

test('createClientId: returns a string in Node (where crypto.randomUUID exists)', () => {
  const id = createClientId();
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 0);
});

test('createClientId: falls back to the non-crypto shape when randomUUID is unavailable', () => {
  const cryptoObj = globalThis.crypto;
  const originalRandomUUID = cryptoObj.randomUUID;
  let removed = false;
  try {
    // Try to remove randomUUID to simulate a non-secure context. It may be
    // non-configurable, or (as in Node) defined on Crypto.prototype, in which
    // case `delete` on the instance is a no-op and the property stays
    // reachable through the prototype chain. So we verify the property is
    // actually gone before trusting the delete.
    try {
      delete cryptoObj.randomUUID;
      removed = typeof cryptoObj.randomUUID !== 'function';
    } catch {
      removed = false;
    }

    if (removed) {
      // randomUUID is truly unavailable: createClientId must use the fallback.
      const id = createClientId();
      assert.match(id, /^id-[a-z0-9-]+$/);
    } else {
      // randomUUID could not be removed; cover the fallback directly.
      const id = randomClientId();
      assert.match(id, /^id-[a-z0-9-]+$/);
    }
  } finally {
    if (removed) {
      cryptoObj.randomUUID = originalRandomUUID;
    }
  }
});

test('randomClientId: 1000 calls are all unique, whitespace-free, and start with a letter', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) {
    const id = randomClientId();
    assert.ok(!/\s/.test(id), `id contains whitespace: ${id}`);
    assert.match(id, /^[a-zA-Z]/, `id does not start with a letter: ${id}`);
    ids.add(id);
  }
  assert.equal(ids.size, 1000);
});

test('randomClientId: ids are safe HTML-id fragments (no spaces, no #)', () => {
  for (let i = 0; i < 100; i++) {
    const id = randomClientId();
    // Must match an HTML5 unquoted id attribute fragment: starts with a
    // letter, then letters/digits/hyphens only. No whitespace, no '#'.
    assert.match(id, /^[a-zA-Z][a-zA-Z0-9-]*$/);
    assert.ok(!id.includes('#'), `id contains '#': ${id}`);
    assert.ok(!/\s/.test(id), `id contains whitespace: ${id}`);
  }
});
