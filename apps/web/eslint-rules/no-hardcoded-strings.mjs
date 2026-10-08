/**
 * Custom ESLint rule (ticket 7.2): no hardcoded user-facing strings.
 *
 * Flags JSX text and string literals in user-facing attributes that contain
 * letters, so a newly hardcoded string fails `npm run lint` (CI gate).
 *
 * What is flagged:
 *  - `JSXText` with at least one letter (e.g. `<div>Save changes</div>`);
 *  - string literals and static template-literal quasis in the guarded
 *    attributes below (e.g. `placeholder="Search titles"`,
 *    `aria-label={`Close ${x}`}`);
 *  - string literals wrapped in a JSX expression in a guarded attribute
 *    (e.g. `placeholder={'Search titles'}`, `title={a ? 'Save' : 'Cancel'}`
 *    — each literal branch is flagged).
 *
 * What is deliberately not flagged (tuned to avoid false positives):
 *  - non-user-facing attributes (`className`, `href`, `role`, `type`, `name`,
 *    `id`, `data-*`, …) — only the `ATTRS` set is guarded;
 *  - dynamic expressions (`{t('…')}`, `{variable}`) — they are not string
 *    literals, so the translator and server-provided values pass; a
 *    conditional whose branches are `t(…)` calls or variables passes too;
 *  - elements marked `translate="no"` (or `translate={false}`) — the HTML
 *    hint that a subtree is intentionally not translatable;
 *  - the brand name `GameShelf` (a proper noun, never translated);
 *  - punctuation/whitespace/number-only values (`×`, `—`, `←`, `·`, `…`,
 *    `404`) — no letters means nothing to translate.
 *
 * Known blind spots (documented, not rule failures): strings returned from
 * `lib/*` helpers, `ApiError` internal messages, and server-provided text are
 * outside JSX and cannot be seen here; the message-parity test and the typed
 * message keys cover the catalogs instead.
 */

const BRAND = ['GameShelf'];

// Attributes whose value is user-facing copy. `label`/`description`/`title`
// are guarded on purpose: a remaining prop with English text must fail, and
// `label={t('…')}` / `label={variable}` pass because they are not literals.
const ATTRS = new Set([
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'title',
  'placeholder',
  'alt',
  'label',
  'eyebrow',
  'submitLabel',
  'description',
]);

const LETTER = /\p{L}/u;
const PUNCT_ONLY = /^[\s\p{P}\p{S}\p{N}]*$/u;

/**
 * The attribute list for a node that may carry `translate`: a
 * `JSXOpeningElement` (the parent of a `JSXAttribute`) has `attributes`
 * directly, while a `JSXElement` (the parent of a `JSXText`) keeps them on
 * `openingElement`.
 */
function attributesOf(node) {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node.attributes)) return node.attributes;
  return node.openingElement?.attributes ?? [];
}

/**
 * Report the string literals an attribute expression hardcodes. Only the
 * shallow, unambiguous shapes are inspected so `t(…)` calls, variables,
 * template literals and other expressions never produce false positives:
 *  - a bare string literal (`{'Search titles'}`);
 *  - the literal branches of a simple conditional
 *    (`{a ? 'Save' : 'Cancel'}` — each literal branch is reported).
 */
function reportExpressionLiterals(expression, report) {
  if (expression === null || expression === undefined) return;
  if (expression.type === 'Literal' && typeof expression.value === 'string') {
    report(expression, expression.value);
    return;
  }
  if (expression.type === 'ConditionalExpression') {
    for (const branch of [expression.consequent, expression.alternate]) {
      if (branch?.type === 'Literal' && typeof branch.value === 'string') {
        report(branch, branch.value);
      }
    }
  }
}

/** True when the element carrying the text/attribute opts out of translation. */
function isTranslateNo(element) {
  return attributesOf(element).some((attribute) => {
    if (
      attribute.type !== 'JSXAttribute' ||
      attribute.name?.name !== 'translate'
    ) {
      return false;
    }
    const value = attribute.value;
    return (
      (value?.type === 'Literal' && value.value === 'no') ||
      (value?.type === 'JSXExpressionContainer' &&
        value.expression?.value === false)
    );
  });
}

export default {
  rules: {
    'no-hardcoded-strings': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          hardcoded:
            'Hardcoded user-facing string "{{text}}". Use a translation message, or mark it translate="no".',
        },
      },
      create(context) {
        function report(node, raw) {
          const value = raw.trim();
          if (
            value === '' ||
            BRAND.includes(value) ||
            PUNCT_ONLY.test(raw) ||
            !LETTER.test(raw)
          ) {
            return;
          }
          context.report({
            node,
            messageId: 'hardcoded',
            data: { text: value.slice(0, 40) },
          });
        }

        return {
          JSXText(node) {
            if (!isTranslateNo(node.parent)) {
              report(node, node.value);
            }
          },
          JSXAttribute(node) {
            const name =
              node.name.type === 'JSXIdentifier' ? node.name.name : null;
            if (
              name === null ||
              !ATTRS.has(name) ||
              isTranslateNo(node.parent)
            ) {
              return;
            }
            const value = node.value;
            if (value?.type === 'Literal' && typeof value.value === 'string') {
              report(value, value.value);
            } else if (
              value?.type === 'JSXExpressionContainer' &&
              value.expression?.type === 'TemplateLiteral'
            ) {
              value.expression.quasis.forEach((quasi) => {
                report(quasi, quasi.value.cooked ?? '');
              });
            } else if (value?.type === 'JSXExpressionContainer') {
              reportExpressionLiterals(value.expression, report);
            }
          },
        };
      },
    },
  },
};
