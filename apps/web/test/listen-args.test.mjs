import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextListenArgs } from '../scripts/listen-args.mjs';

test('defaults to port 3000 with no hostname', () => {
  assert.deepEqual(nextListenArgs({}), ['--port', '3000']);
});

test('reads WEB_PORT', () => {
  assert.deepEqual(nextListenArgs({ WEB_PORT: '4000' }), ['--port', '4000']);
});

test('adds --hostname for WEB_HOST', () => {
  assert.deepEqual(nextListenArgs({ WEB_HOST: '0.0.0.0' }), [
    '--port',
    '3000',
    '--hostname',
    '0.0.0.0',
  ]);
});

test('treats blank values as the defaults', () => {
  assert.deepEqual(nextListenArgs({ WEB_PORT: ' ', WEB_HOST: '' }), [
    '--port',
    '3000',
  ]);
});

test("ignores Next's own PORT and HOSTNAME", () => {
  assert.deepEqual(nextListenArgs({ PORT: '5000', HOSTNAME: 'box' }), [
    '--port',
    '3000',
  ]);
});
