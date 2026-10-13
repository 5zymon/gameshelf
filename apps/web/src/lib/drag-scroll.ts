import { scrollEdges, type ScrollMetrics } from './scroll-edges';

/** Horizontal pointer travel before a press is treated as a drag (below is a click). */
export const DRAG_THRESHOLD_PX = 5;
/** Pointer samples newer than this (ms) count toward the release velocity. */
export const VELOCITY_WINDOW_MS = 100;
/** A pause of this length (ms) before release kills the glide (the pointer was held still). */
export const RELEASE_IDLE_MS = 50;
/** Release-velocity cap (px/ms) so a flick cannot launch the strip across the page. */
export const MAX_VELOCITY = 4;
/** Nominal frame interval (60 Hz) the friction constant is defined per. */
export const FRAME_MS = 1000 / 60;
/** Velocity kept per 60 Hz frame (glide ≈ v0 × 325 ms). */
export const FRICTION_PER_FRAME = 0.95;
/** Glide velocity below this (px/ms) stops the glide. */
export const MIN_VELOCITY = 0.02;
/** dt cap (ms) so a stalled/background frame cannot teleport the strip. */
export const MAX_FRAME_MS = 32;
/** Wheel `deltaMode: 1` (line) multiplier (px per line). */
export const WHEEL_LINE_PX = 40;
/** Wheel events closer than this (ms) belong to the same gesture (the latch). */
export const WHEEL_GESTURE_GAP_MS = 250;

export interface PointerSample {
  t: number;
  x: number;
}

export interface MomentumState {
  position: number;
  velocity: number;
}

export interface MomentumFrame extends MomentumState {
  done: boolean;
}

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
}

export interface WheelGesture {
  owner: 'strip' | 'page';
  at: number;
}

/** How far the content can scroll (0 when it does not overflow). */
export function maxScroll(
  m: Pick<ScrollMetrics, 'scrollWidth' | 'clientWidth'>,
): number {
  return Math.max(0, m.scrollWidth - m.clientWidth);
}

/** Clamps `value` into `[0, max]`, tolerating a negative max (transient shrink). */
export function clampScroll(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(max, 0));
}

/** Whether a horizontal pointer travel of `dx` px is a drag (not a click). */
export function isDragGesture(dx: number): boolean {
  return Math.abs(dx) >= DRAG_THRESHOLD_PX;
}

/**
 * Pointer velocity (px/ms) at release from recent samples: only the last
 * `VELOCITY_WINDOW_MS` count, a pause of `RELEASE_IDLE_MS` before release
 * yields 0, and the result is clamped to ±`MAX_VELOCITY`.
 */
export function releaseVelocity(
  samples: readonly PointerSample[],
  releaseTime: number,
): number {
  const recent = samples.filter((s) => releaseTime - s.t <= VELOCITY_WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (releaseTime - last.t > RELEASE_IDLE_MS) return 0;
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  const v = (last.x - first.x) / dt;
  return Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, v));
}

/**
 * One glide step with exact exponential decay (frame-rate independent): the
 * same total glide is covered by one long frame or many short ones. Stops at
 * either end (clamped there) and when the velocity drops below `MIN_VELOCITY`.
 */
export function momentumStep(
  state: MomentumState,
  dtMs: number,
  max: number,
): MomentumFrame {
  const dt = Math.min(Math.max(dtMs, 0), MAX_FRAME_MS);
  const k = -Math.log(FRICTION_PER_FRAME) / FRAME_MS;
  const decay = Math.exp(-k * dt);
  const position = state.position + (state.velocity * (1 - decay)) / k;
  const velocity = state.velocity * decay;
  if (position <= 0) return { position: 0, velocity: 0, done: true };
  if (position >= max) return { position: max, velocity: 0, done: true };
  if (Math.abs(velocity) < MIN_VELOCITY) {
    return { position, velocity, done: true };
  }
  return { position, velocity, done: false };
}

/**
 * Vertical wheel delta converted to a horizontal scroll delta (px). Zero for
 * pinch-zoom (`ctrlKey`) and for horizontal-dominant input (trackpad swipe,
 * shift-wheel), which native scrolling already handles.
 */
export function wheelScrollDelta(input: WheelInput, pageSize: number): number {
  if (input.ctrlKey) return 0;
  if (Math.abs(input.deltaX) >= Math.abs(input.deltaY)) return 0;
  const scale =
    input.deltaMode === 1
      ? WHEEL_LINE_PX
      : input.deltaMode === 2
        ? pageSize
        : 1;
  return input.deltaY * scale;
}

/**
 * Whether the strip should consume a wheel delta of that sign: it must
 * overflow and still have room to move that way (reuses the 1 px edge
 * tolerance). No overflow → false both ways.
 */
export function consumesWheel(metrics: ScrollMetrics, delta: number): boolean {
  if (delta > 0) return scrollEdges(metrics).end;
  if (delta < 0) return scrollEdges(metrics).start;
  return false;
}

/**
 * The wheel-gesture latch: events within `WHEEL_GESTURE_GAP_MS` of the
 * previous one keep its owner (a page scroll passing over the strip is not
 * hijacked); a longer gap starts a new gesture owned by where it began.
 */
export function wheelGestureOwner(
  prev: WheelGesture | null,
  now: number,
  inStrip: boolean,
): WheelGesture {
  if (prev !== null && now - prev.at <= WHEEL_GESTURE_GAP_MS) {
    return { owner: prev.owner, at: now };
  }
  return { owner: inStrip ? 'strip' : 'page', at: now };
}
