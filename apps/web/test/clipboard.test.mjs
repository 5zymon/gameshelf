import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for `extractImageFiles` in `lib/import/selection.ts` — the clipboard
 * extraction behind paste-to-upload on /import. `selection.ts` has no runtime
 * imports (its `@/i18n/translate` import is type-only and erased), so Node's
 * native TS type-stripping imports it directly.
 */
const { extractImageFiles } = await import('../src/lib/import/selection.ts');

function imageFile(name = 'image.png', type = 'image/png') {
  return new File(['x'], name, { type });
}

function dataTransfer({ files = [], items = [] } = {}) {
  return { files, items };
}

function fileItem(file, type) {
  return { kind: 'file', type, getAsFile: () => file };
}

test('returns image files from clipboardData.files, in order', () => {
  const png = imageFile('shot.png');
  const heic = imageFile('photo.heic', 'image/heic');
  const text = imageFile('notes.txt', 'text/plain');
  const result = extractImageFiles(dataTransfer({ files: [png, text, heic] }));
  assert.deepEqual(result, [png, heic]); // same references, order preserved
});

test('falls back to clipboardData.items when files is empty', () => {
  const png = imageFile('shot.png');
  const result = extractImageFiles(
    dataTransfer({
      items: [
        fileItem(png, 'image/png'),
        { kind: 'string', type: 'text/plain' },
      ],
    }),
  );
  assert.deepEqual(result, [png]);
});

test('prefers files over items when both are present', () => {
  const fromFiles = imageFile('from-files.png');
  const fromItems = imageFile('from-items.png');
  const result = extractImageFiles(
    dataTransfer({ files: [fromFiles], items: [fileItem(fromItems)] }),
  );
  assert.deepEqual(result, [fromFiles]);
});

test('returns [] for a text-only clipboard so text pastes are untouched', () => {
  const result = extractImageFiles(
    dataTransfer({
      files: [imageFile('notes.txt', 'text/plain')],
      items: [{ kind: 'string', type: 'text/plain' }],
    }),
  );
  assert.deepEqual(result, []);
});

test('returns [] when the clipboard is empty', () => {
  assert.deepEqual(extractImageFiles(dataTransfer()), []);
});

test('skips file items whose getAsFile() returns null', () => {
  const ok = imageFile('ok.png');
  const result = extractImageFiles(
    dataTransfer({
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => null },
        fileItem(ok, 'image/png'),
      ],
    }),
  );
  assert.deepEqual(result, [ok]);
});

test('accepts an image file with an empty MIME via its extension', () => {
  const heic = imageFile('photo.heic', '');
  const result = extractImageFiles(dataTransfer({ files: [heic] }));
  assert.deepEqual(result, [heic]);
});

test('falls back to items when files holds only a non-image', () => {
  const text = imageFile('notes.txt', 'text/plain');
  const png = imageFile('shot.png');
  const result = extractImageFiles(
    dataTransfer({
      files: [text],
      items: [fileItem(png, 'image/png')],
    }),
  );
  assert.deepEqual(result, [png]);
});
