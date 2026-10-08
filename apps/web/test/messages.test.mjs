import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Message-catalog parity test (ticket 7.2). The two catalogs must stay in lock
 * step so a key added in one locale cannot silently go missing in the other:
 *  - the same set of dotted keys in both,
 *  - every leaf is a non-blank string,
 *  - the same ICU placeholders per key in both.
 */
const PL_PATH = join(__dirname, '..', 'messages', 'pl.json');
const EN_PATH = join(__dirname, '..', 'messages', 'en.json');

function flatten(obj, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'object' && value !== null) {
      Object.assign(out, flatten(value, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

function placeholders(value) {
  const set = new Set();
  const re = /\{([a-zA-Z0-9_]+)(?:,|\})/g;
  let match;
  while ((match = re.exec(value)) !== null) {
    set.add(match[1]);
  }
  return set;
}

function setDiff(a, b) {
  const missing = [...a].filter((x) => !b.has(x));
  const extra = [...b].filter((x) => !a.has(x));
  return { missing, extra };
}

test('message catalogs (pl/en) are in parity', async () => {
  const pl = JSON.parse(await readFile(PL_PATH, 'utf8'));
  const en = JSON.parse(await readFile(EN_PATH, 'utf8'));

  const plFlat = flatten(pl);
  const enFlat = flatten(en);
  const plKeys = new Set(Object.keys(plFlat));
  const enKeys = new Set(Object.keys(enFlat));

  // 1. Same key set in both directions.
  const { missing: enMissing, extra: enExtra } = setDiff(plKeys, enKeys);
  assert.deepEqual(
    enMissing,
    [],
    `Keys present in pl.json but missing from en.json: ${enMissing.join(', ')}`,
  );
  const { missing: plMissing, extra: plExtra } = setDiff(enKeys, plKeys);
  assert.deepEqual(
    plMissing,
    [],
    `Keys present in en.json but missing from pl.json: ${plMissing.join(', ')}`,
  );
  assert.equal(
    enExtra.length,
    0,
    `Unexpected extra keys: ${enExtra.join(', ')}`,
  );
  assert.equal(
    plExtra.length,
    0,
    `Unexpected extra keys: ${plExtra.join(', ')}`,
  );

  // 2. Every leaf is a non-blank string, in both catalogs.
  for (const [path, value] of Object.entries(plFlat)) {
    assert.equal(
      typeof value,
      'string',
      `pl.json "${path}" must be a string, got ${typeof value}`,
    );
    assert.notEqual(value.trim(), '', `pl.json "${path}" must not be blank`);
  }
  for (const [path, value] of Object.entries(enFlat)) {
    assert.equal(
      typeof value,
      'string',
      `en.json "${path}" must be a string, got ${typeof value}`,
    );
    assert.notEqual(value.trim(), '', `en.json "${path}" must not be blank`);
  }

  // 3. Same ICU placeholders per key in both catalogs.
  for (const path of plKeys) {
    const plPh = placeholders(plFlat[path]);
    const enPh = placeholders(enFlat[path]);
    const { missing: enMissPh, extra: enExtraPh } = setDiff(plPh, enPh);
    assert.deepEqual(
      enMissPh,
      [],
      `en.json "${path}" is missing placeholders: ${enMissPh.join(', ')}`,
    );
    assert.equal(
      enExtraPh.length,
      0,
      `en.json "${path}" has extra placeholders: ${enExtraPh.join(', ')}`,
    );
  }
});
