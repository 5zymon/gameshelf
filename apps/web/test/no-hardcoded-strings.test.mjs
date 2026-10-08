import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import gameshelf from '../eslint-rules/no-hardcoded-strings.mjs';

/**
 * Rule tests for `gameshelf/no-hardcoded-strings` (ticket 7.2), run through
 * the ESLint `Linter` flat API so the rule is exercised exactly as the flat
 * config in `eslint.config.mjs` does. The CI lint gate is the enforcement;
 * these tests pin the rule's behavior (what is and is not flagged).
 */
const linter = new Linter();

function lint(code) {
  return linter.verify(code, {
    plugins: { gameshelf },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: { 'gameshelf/no-hardcoded-strings': 'error' },
  });
}

test('flags a hardcoded user-facing JSX text with 1 error', () => {
  const result = lint('<div>Save changes</div>');
  assert.equal(result.length, 1);
  assert.equal(result[0].ruleId, 'gameshelf/no-hardcoded-strings');
  assert.match(
    result[0].message,
    /Hardcoded user-facing string "Save changes"/,
  );
});

test('does not flag translator calls or dynamic expressions in JSX', () => {
  assert.deepEqual(lint('<div>{t("save")}</div>'), []);
  assert.deepEqual(lint('<div>{label}</div>'), []);
});

test('does not flag translate="no" elements', () => {
  assert.deepEqual(lint('<div translate="no">Some brand text</div>'), []);
  assert.deepEqual(lint('<span translate={false}>© 2026</span>'), []);
});

test('flags a hardcoded string literal in a guarded attribute', () => {
  const result = lint('<input placeholder="Search titles" />');
  assert.equal(result.length, 1);
  assert.match(result[0].message, /"Search titles"/);
});

test('flags a static template-literal quasi in a guarded attribute', () => {
  const result = lint('<button aria-label={`Close ${name}`} />');
  assert.equal(result.length, 1);
  assert.match(result[0].message, /"Close"/);
});

test('does not flag dynamic expressions in guarded attributes', () => {
  assert.deepEqual(lint('<input placeholder={t("search")} />'), []);
  assert.deepEqual(lint('<input aria-label={label} />'), []);
  assert.deepEqual(lint('<input placeholder={variable} />'), []);
});

test('flags a string literal wrapped in a JSX expression in a guarded attribute', () => {
  const result = lint("<input placeholder={'Hardcoded'} />");
  assert.equal(result.length, 1);
  assert.match(result[0].message, /"Hardcoded"/);
});

test('does not flag translator calls or variables in JSX expressions', () => {
  assert.deepEqual(lint("<input placeholder={t('key')} />"), []);
  assert.deepEqual(lint('<input placeholder={variable} />'), []);
});

test('flags literal branches of a simple conditional in a guarded attribute', () => {
  const result = lint("<button title={a ? 'Save' : 'Cancel'} />");
  assert.equal(result.length, 2);
  assert.match(result[0].message, /"Save"/);
  assert.match(result[1].message, /"Cancel"/);
});

test('does not flag conditionals whose branches are translator calls or variables', () => {
  assert.deepEqual(lint("<button title={a ? t('save') : t('cancel')} />"), []);
  assert.deepEqual(lint('<button title={a ? labelA : labelB} />'), []);
});

test('guards the eyebrow attribute like the other user-facing attributes', () => {
  const result = lint('<div eyebrow="Games" />');
  assert.equal(result.length, 1);
  assert.match(result[0].message, /"Games"/);
  assert.deepEqual(lint("<div eyebrow={t('games')} />"), []);
  assert.deepEqual(lint('<div eyebrow={eyebrow} />'), []);
});

test('still exempts translate="no" elements with hardcoded attributes', () => {
  assert.deepEqual(
    lint('<input translate="no" placeholder="Hardcoded" />'),
    [],
  );
  assert.deepEqual(
    lint("<input translate={false} title={a ? 'Save' : 'Cancel'} />"),
    [],
  );
});

test('does not flag non-user-facing attributes', () => {
  assert.deepEqual(
    lint(
      '<a className="text-fog" href="/games" role="button" name="x" id="y" data-testid="z">{label}</a>',
    ),
    [],
  );
});

test('allows the brand name and punctuation-only values', () => {
  assert.deepEqual(lint('<h1>GameShelf</h1>'), []);
  assert.deepEqual(lint('<button aria-label="×" />'), []);
  assert.deepEqual(lint('<p>404</p>'), []);
});
