import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const { scripts } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

test('dev and start launch Next through run-next.mjs', () => {
  for (const name of ['dev', 'start']) {
    assert.match(scripts[name], /scripts\/run-next\.mjs/);
  }
});

test('dev and start never hardcode a port', () => {
  for (const name of ['dev', 'start']) {
    assert.doesNotMatch(scripts[name], /--port/);
    assert.doesNotMatch(scripts[name], /3000/);
  }
});
