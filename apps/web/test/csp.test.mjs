import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/csp.ts` — the strict Content-Security-Policy the middleware
 * attaches to every response. Card 9.1 adds the YouTube embed hosts (the only
 * sanctioned external origins) to `script-src` and a new `frame-src`.
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

const {
  contentSecurityPolicy,
  YOUTUBE_EMBED_SOURCES,
  YOUTUBE_THUMBNAIL_SOURCES,
} = await import('../src/lib/csp.ts');

const NONCE = 'test-nonce';
const YOUTUBE = YOUTUBE_EMBED_SOURCES.join(' ');
const YOUTUBE_THUMBNAILS = YOUTUBE_THUMBNAIL_SOURCES.join(' ');

test('production policy allows only the YouTube hosts as a frame source', () => {
  const csp = contentSecurityPolicy(NONCE, false);

  assert.match(csp, new RegExp(`frame-src 'self' ${YOUTUBE}(;|$)`));
  // Every other fetch directive stays self-only.
  assert.match(csp, /(^|; )default-src 'self'/);
  assert.match(csp, /(^|; )connect-src 'self'/);
  // `img-src` keeps `'self'`/`blob:` and adds only the YouTube thumbnail host.
  assert.match(
    csp,
    new RegExp(`(^|; )img-src 'self' blob: ${YOUTUBE_THUMBNAILS}(;|$)`),
  );
});

test('production policy names the YouTube hosts in script-src and drops unsafe-eval', () => {
  const csp = contentSecurityPolicy(NONCE, false);

  const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'));
  assert.ok(scriptSrc, 'script-src directive is present');
  assert.match(scriptSrc, /'self'/);
  assert.match(scriptSrc, /'nonce-test-nonce'/);
  assert.match(scriptSrc, /'strict-dynamic'/);
  assert.match(scriptSrc, /https:\/\/www\.youtube\.com/);
  assert.match(scriptSrc, /https:\/\/player\.youtube\.com/);
  // Exactly the two YouTube embed hosts, and no other https origin.
  assert.deepEqual(
    (scriptSrc.match(/https:\/\/[^ ]+/g) ?? []).sort(),
    [...YOUTUBE_EMBED_SOURCES].sort(),
    'script-src names exactly the two YouTube embed hosts',
  );
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test('development policy adds unsafe-eval and inline styles', () => {
  const csp = contentSecurityPolicy(NONCE, true);

  assert.match(csp, /unsafe-eval/);
  assert.match(csp, /(^|; )style-src 'self' 'unsafe-inline'/);
});

test('production style-src is nonce-based, not unsafe-inline', () => {
  const csp = contentSecurityPolicy(NONCE, false);

  assert.match(csp, /(^|; )style-src 'self' 'nonce-test-nonce'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
});

test('no directive uses a bare wildcard, and only YouTube adds an https origin', () => {
  const csp = contentSecurityPolicy(NONCE, false);

  // No `*` source anywhere.
  assert.doesNotMatch(csp, /\*/);
  // `img-src` keeps `'self'` and `blob:` and may name only the YouTube
  // thumbnail host — no other external origin.
  const imgSrc = csp.split('; ').find((d) => d.startsWith('img-src '));
  assert.ok(imgSrc, 'img-src directive is present');
  assert.match(imgSrc, /'self'/);
  assert.match(imgSrc, /blob:/);
  assert.ok(
    imgSrc.includes(YOUTUBE_THUMBNAILS),
    `img-src contains ${YOUTUBE_THUMBNAILS}`,
  );
  assert.equal(
    imgSrc.match(/https:/g)?.length,
    1,
    'img-src names exactly one https origin',
  );
  // Every other directive except `script-src`/`frame-src` (the card-9.1 YouTube
  // exception) stays free of external origins.
  for (const directive of [
    'default-src',
    'connect-src',
    'font-src',
    'style-src',
  ]) {
    const value = csp.split('; ').find((d) => d.startsWith(`${directive} `));
    assert.ok(value, `${directive} directive is present`);
    assert.doesNotMatch(value, /https:/, `${directive} has no https origin`);
  }
});

test('policy locks down object, base and framing directives', () => {
  const csp = contentSecurityPolicy(NONCE, false);

  assert.match(csp, /(^|; )object-src 'none'/);
  assert.match(csp, /(^|; )base-uri 'self'/);
  assert.match(csp, /(^|; )form-action 'self'/);
  assert.match(csp, /(^|; )frame-ancestors 'none'/);
});
