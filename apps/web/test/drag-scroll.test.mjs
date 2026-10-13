import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/drag-scroll.ts` — the pure helpers behind the platform chip
 * strip's drag-to-pan (threshold, release velocity, exponential-decay glide)
 * and vertical-wheel-to-horizontal scrolling (delta conversion, consume
 * decision, gesture latch).
 *
 * The source imports `./scroll-edges` at runtime, so the `@/` + extensionless
 * resolve hook is copied from `catalog-filters.test.mjs`.
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
  DRAG_THRESHOLD_PX,
  MAX_VELOCITY,
  MIN_VELOCITY,
  FRAME_MS,
  FRICTION_PER_FRAME,
  MAX_FRAME_MS,
  WHEEL_LINE_PX,
  WHEEL_GESTURE_GAP_MS,
  clampScroll,
  consumesWheel,
  isDragGesture,
  maxScroll,
  momentumStep,
  releaseVelocity,
  wheelGestureOwner,
  wheelScrollDelta,
} = await import('../src/lib/drag-scroll.ts');

/** Overflows by 500 px (800 - 300), so `maxScroll` is 500. */
const M = (scrollLeft) => ({ scrollLeft, scrollWidth: 800, clientWidth: 300 });

test('maxScroll / clampScroll: overflow, no overflow, clamping', () => {
  assert.equal(maxScroll({ scrollWidth: 800, clientWidth: 300 }), 500);
  assert.equal(maxScroll({ scrollWidth: 295, clientWidth: 300 }), 0);
  assert.equal(clampScroll(-5, 500), 0);
  assert.equal(clampScroll(520, 500), 500);
  assert.equal(clampScroll(250.5, 500), 250.5);
  // A transient shrink (negative max) clamps everything to 0.
  assert.equal(clampScroll(10, -5), 0);
  assert.equal(clampScroll(-10, -5), 0);
  assert.equal(clampScroll(0, -5), 0);
});

test('isDragGesture: the 5 px threshold (both directions)', () => {
  assert.equal(DRAG_THRESHOLD_PX, 5);
  assert.equal(isDragGesture(0), false);
  assert.equal(isDragGesture(4.99), false);
  assert.equal(isDragGesture(5), true);
  assert.equal(isDragGesture(-5), true);
});

test('releaseVelocity: empty/single samples yield 0, steady motion yields the speed', () => {
  assert.equal(releaseVelocity([], 100), 0);
  assert.equal(releaseVelocity([{ t: 0, x: 0 }], 10), 0);
  // 160 px over 80 ms, released while still moving.
  assert.equal(
    releaseVelocity(
      [
        { t: 0, x: 0 },
        { t: 40, x: 80 },
        { t: 80, x: 160 },
      ],
      80,
    ),
    2,
  );
});

test('releaseVelocity: window, idle pause and the ±MAX_VELOCITY clamp', () => {
  // The t=0 sample is 140 ms old (> 100 ms window) and must be ignored:
  // (190 - 100) / (140 - 50) = 1, not 190 / 140.
  assert.equal(
    releaseVelocity(
      [
        { t: 0, x: 0 },
        { t: 50, x: 100 },
        { t: 140, x: 190 },
      ],
      140,
    ),
    1,
  );
  // The pointer paused 60 ms (> 50 ms) before release → no glide.
  assert.equal(
    releaseVelocity(
      [
        { t: 0, x: 0 },
        { t: 40, x: 100 },
      ],
      100,
    ),
    0,
  );
  // 1000 px in 10 ms is clamped to ±MAX_VELOCITY.
  assert.equal(
    releaseVelocity(
      [
        { t: 0, x: 0 },
        { t: 10, x: 1000 },
      ],
      10,
    ),
    MAX_VELOCITY,
  );
  assert.equal(
    releaseVelocity(
      [
        { t: 0, x: 1000 },
        { t: 10, x: 0 },
      ],
      10,
    ),
    -MAX_VELOCITY,
  );
});

test('momentumStep: exact exponential decay, frame-rate independent', () => {
  const full = momentumStep({ position: 100, velocity: 1 }, FRAME_MS, 10000);
  assert.ok(Math.abs(full.velocity - FRICTION_PER_FRAME) < 1e-12);
  const half1 = momentumStep(
    { position: 100, velocity: 1 },
    FRAME_MS / 2,
    10000,
  );
  const half2 = momentumStep(
    { position: half1.position, velocity: half1.velocity },
    FRAME_MS / 2,
    10000,
  );
  assert.ok(Math.abs(half2.position - full.position) < 1e-9);
  assert.ok(Math.abs(half2.velocity - full.velocity) < 1e-9);
});

test('momentumStep: the ends stop the glide (clamped, zero velocity)', () => {
  assert.deepEqual(momentumStep({ position: 1, velocity: -1 }, FRAME_MS, 500), {
    position: 0,
    velocity: 0,
    done: true,
  });
  assert.deepEqual(
    momentumStep({ position: 490, velocity: 1 }, FRAME_MS, 500),
    { position: 500, velocity: 0, done: true },
  );
  // max = 0 (no overflow) ends at position 0.
  assert.deepEqual(momentumStep({ position: 100, velocity: 1 }, FRAME_MS, 0), {
    position: 0,
    velocity: 0,
    done: true,
  });
});

test('momentumStep: below MIN_VELOCITY stops; dt is capped; negative dt moves nothing', () => {
  const slow = momentumStep({ position: 100, velocity: 0.01 }, FRAME_MS, 500);
  assert.equal(slow.done, true);
  assert.ok(slow.velocity < MIN_VELOCITY);

  const capped = momentumStep({ position: 100, velocity: 1 }, 1000, 100000);
  const limit = momentumStep(
    { position: 100, velocity: 1 },
    MAX_FRAME_MS,
    100000,
  );
  assert.deepEqual(capped, limit);

  const negative = momentumStep({ position: 100, velocity: 1 }, -50, 500);
  assert.equal(negative.position, 100);
});

test('wheelScrollDelta: pixel/line/page modes, horizontal and ctrl are 0', () => {
  assert.equal(WHEEL_LINE_PX, 40);
  assert.equal(
    wheelScrollDelta(
      { deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false },
      300,
    ),
    100,
  );
  assert.equal(
    wheelScrollDelta(
      { deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false },
      300,
    ),
    120,
  );
  assert.equal(
    wheelScrollDelta(
      { deltaX: 0, deltaY: 1, deltaMode: 2, ctrlKey: false },
      300,
    ),
    300,
  );
  // Horizontal-dominant (trackpad swipe, shift-wheel) is left to native scrolling.
  assert.equal(
    wheelScrollDelta(
      { deltaX: 50, deltaY: 10, deltaMode: 0, ctrlKey: false },
      300,
    ),
    0,
  );
  assert.equal(
    wheelScrollDelta(
      { deltaX: 10, deltaY: 10, deltaMode: 0, ctrlKey: false },
      300,
    ),
    0,
  );
  // Pinch-zoom is never consumed.
  assert.equal(
    wheelScrollDelta(
      { deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: true },
      300,
    ),
    0,
  );
  // A negative deltaY keeps its sign (scrolls the strip left).
  assert.equal(
    wheelScrollDelta(
      { deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false },
      300,
    ),
    -100,
  );
});

test('consumesWheel: only when the strip can still move that way', () => {
  // No overflow → false both ways.
  const noOverflow = { scrollLeft: 0, scrollWidth: 300, clientWidth: 300 };
  assert.equal(consumesWheel(noOverflow, 1), false);
  assert.equal(consumesWheel(noOverflow, -1), false);
  // At the start: only the end direction is consumed.
  assert.equal(consumesWheel(M(0), -1), false);
  assert.equal(consumesWheel(M(0), 1), true);
  // At the end: only the start direction is consumed.
  assert.equal(consumesWheel(M(500), 1), false);
  assert.equal(consumesWheel(M(500), -1), true);
  // Mid-scroll: both.
  assert.equal(consumesWheel(M(250), 1), true);
  assert.equal(consumesWheel(M(250), -1), true);
  // Sub-pixel positions within the 1 px tolerance count as the ends.
  assert.equal(consumesWheel(M(0.4), -1), false);
  assert.equal(consumesWheel(M(0.4), 1), true);
  assert.equal(consumesWheel(M(499.5), 1), false);
  assert.equal(consumesWheel(M(499.5), -1), true);
  // A zero delta is never consumed.
  assert.equal(consumesWheel(M(250), 0), false);
});

test('wheelGestureOwner: the 250 ms latch keeps the gesture owner', () => {
  assert.equal(WHEEL_GESTURE_GAP_MS, 250);
  assert.deepEqual(wheelGestureOwner(null, 1000, true), {
    owner: 'strip',
    at: 1000,
  });
  assert.deepEqual(wheelGestureOwner(null, 1000, false), {
    owner: 'page',
    at: 1000,
  });
  // A page scroll passing over the strip within 250 ms is not hijacked.
  assert.deepEqual(wheelGestureOwner({ owner: 'page', at: 1000 }, 1200, true), {
    owner: 'page',
    at: 1200,
  });
  // After the gap the owner is re-evaluated from where the gesture is now.
  assert.deepEqual(wheelGestureOwner({ owner: 'page', at: 1000 }, 1251, true), {
    owner: 'strip',
    at: 1251,
  });
});
