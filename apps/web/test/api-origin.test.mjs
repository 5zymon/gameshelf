import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const nextConfigUrl = new URL('../next.config.mjs', import.meta.url).href;

// @next/env snapshots process.env on its first load, so each case runs the real
// next.config.mjs in a fresh process.
function rewritesDestination(env) {
  const script = [
    `const { default: config } = await import(${JSON.stringify(nextConfigUrl)});`,
    `const [rewrite] = await config.rewrites();`,
    `console.log('DESTINATION:' + rewrite.destination);`,
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const match = /^DESTINATION:(.*)$/m.exec(result.stdout);
  assert.notEqual(match, null, result.stdout);
  return match[1];
}

test('a blank NEXT_PUBLIC_API_URL derives the origin from API_PORT', () => {
  assert.equal(
    rewritesDestination({ API_PORT: '4001', NEXT_PUBLIC_API_URL: '' }),
    'http://localhost:4001/:path*',
  );
});

test('a blank API_PORT means 3001', () => {
  assert.equal(
    rewritesDestination({ API_PORT: '  ', NEXT_PUBLIC_API_URL: ' ' }),
    'http://localhost:3001/:path*',
  );
});

test('an explicit NEXT_PUBLIC_API_URL wins and loses its trailing slash', () => {
  assert.equal(
    rewritesDestination({
      API_PORT: '4001',
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:9999/',
    }),
    'http://127.0.0.1:9999/:path*',
  );
});
