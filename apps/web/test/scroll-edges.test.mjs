import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for `lib/scroll-edges.ts` — the pure helper behind the platform chip
 * strip's edge fades: given a scroll container's metrics, decide whether more
 * content lies beyond the start (left) and end (right) edge.
 *
 * The source is TypeScript with no imports (only type declarations), so Node's
 * default type-stripping loads it directly and no resolve hook is needed.
 */
const { scrollEdges, SCROLL_EDGE_EPSILON } =
  await import('../src/lib/scroll-edges.ts');

/** Overflows by 500 px (800 - 300), so `maxScroll` is 500. */
const M = (scrollLeft) => ({ scrollLeft, scrollWidth: 800, clientWidth: 300 });

test('no overflow shows no fades', () => {
  assert.deepEqual(
    scrollEdges({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }),
    {
      start: false,
      end: false,
    },
  );
  // A transient shrink (scrollWidth < clientWidth) makes maxScroll negative;
  // no fades show at either edge.
  assert.deepEqual(
    scrollEdges({ scrollLeft: 0, scrollWidth: 295, clientWidth: 300 }),
    {
      start: false,
      end: false,
    },
  );
});

test('overflow within the tolerance shows no fades', () => {
  assert.deepEqual(
    scrollEdges({ scrollLeft: 0, scrollWidth: 301, clientWidth: 300 }),
    {
      start: false,
      end: false,
    },
  );
});

test('at the start, only the end fade shows (including sub-pixel)', () => {
  assert.deepEqual(scrollEdges(M(0)), { start: false, end: true });
  assert.deepEqual(scrollEdges(M(0.4)), { start: false, end: true });
});

test('mid-scroll shows both fades', () => {
  assert.deepEqual(scrollEdges(M(250)), { start: true, end: true });
});

test('at the end, only the start fade shows (including fractional)', () => {
  assert.deepEqual(scrollEdges(M(500)), { start: true, end: false });
  assert.deepEqual(scrollEdges(M(499.5)), { start: true, end: false });
  assert.deepEqual(scrollEdges(M(499.2)), { start: true, end: false });
});

test('elastic overscroll counts as being at that end', () => {
  assert.deepEqual(scrollEdges(M(-12)), { start: false, end: true });
  assert.deepEqual(scrollEdges(M(512)), { start: true, end: false });
});

test('the tolerance is one CSS pixel', () => {
  assert.equal(SCROLL_EDGE_EPSILON, 1);
  assert.equal(scrollEdges(M(1)).start, false);
  assert.equal(scrollEdges(M(1.01)).start, true);
  assert.equal(scrollEdges(M(499)).end, false);
  assert.equal(scrollEdges(M(498.9)).end, true);
});
