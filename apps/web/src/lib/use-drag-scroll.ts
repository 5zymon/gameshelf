import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  clampScroll,
  consumesWheel,
  isDragGesture,
  maxScroll,
  momentumStep,
  releaseVelocity,
  wheelGestureOwner,
  wheelScrollDelta,
  MIN_VELOCITY,
  VELOCITY_WINDOW_MS,
  type PointerSample,
  type WheelGesture,
} from './drag-scroll';
import { SCROLL_EDGE_EPSILON } from './scroll-edges';

export interface DragScrollHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startScroll: number;
  active: boolean;
  samples: PointerSample[];
}

interface MomentumRun {
  frame: number;
  position: number;
  velocity: number;
  last: number;
}

/**
 * Mouse drag-to-pan with release momentum for a horizontal scroller, plus
 * vertical-wheel-to-horizontal scrolling. Mouse only: touch and pen keep
 * native `overflow-x-auto` panning (a JS drag would fight it, and the browser
 * fires `pointercancel` when it takes over). The pointer is captured only once
 * a real drag starts (≥ `DRAG_THRESHOLD_PX`), so a plain click still targets
 * the chip; a post-drag click is swallowed in `onClickCapture`.
 */
export function useDragScroll(ref: RefObject<HTMLElement | null>): {
  dragging: boolean;
  stopMomentum: () => void;
  handlers: DragScrollHandlers;
} {
  const dragRef = useRef<DragState | null>(null);
  const momentumRef = useRef<MomentumRun | null>(null);
  const suppressClickRef = useRef(false);
  const wheelGestureRef = useRef<WheelGesture | null>(null);
  // Flips only at drag start and end: two re-renders per drag.
  const [dragging, setDragging] = useState(false);

  const stopMomentum = useCallback(() => {
    const m = momentumRef.current;
    if (m !== null) {
      cancelAnimationFrame(m.frame);
      momentumRef.current = null;
    }
  }, []);

  const startMomentum = useCallback(
    (position: number, velocity: number): void => {
      if (Math.abs(velocity) < MIN_VELOCITY) return;
      const tick = (now: number): void => {
        const m = momentumRef.current;
        const el = ref.current;
        if (m === null || el === null) return;
        // The position is tracked as a float here (some engines round
        // `scrollLeft`), and `maxScroll` is re-read every frame (resizes).
        const next = momentumStep(
          { position: m.position, velocity: m.velocity },
          now - m.last,
          maxScroll(el),
        );
        el.scrollLeft = next.position;
        if (next.done) {
          momentumRef.current = null;
          return;
        }
        m.position = next.position;
        m.velocity = next.velocity;
        m.last = now;
        m.frame = requestAnimationFrame(tick);
      };
      momentumRef.current = {
        position,
        velocity,
        last: performance.now(),
        frame: requestAnimationFrame(tick),
      };
    },
    [ref],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // Any press (mouse, touch, pen) catches a running glide.
      stopMomentum();
      suppressClickRef.current = false;
      if (
        event.pointerType !== 'mouse' ||
        event.button !== 0 ||
        !event.isPrimary
      ) {
        return;
      }
      const el = ref.current;
      // Nothing overflows → nothing to drag.
      if (el === null || maxScroll(el) <= SCROLL_EDGE_EPSILON) return;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startScroll: el.scrollLeft,
        active: false,
        samples: [{ t: event.timeStamp, x: event.clientX }],
      };
      // No `preventDefault`, no capture yet: capturing at pointerdown would
      // move the `click` target from the chip to the scroller.
    },
    [ref, stopMomentum],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      const el = ref.current;
      if (drag === null || el === null || event.pointerId !== drag.pointerId) {
        return;
      }
      // The mouse was released outside the strip before capture and we never
      // saw the `pointerup` — recover on the next move.
      if ((event.buttons & 1) === 0) {
        const wasActive = drag.active;
        dragRef.current = null;
        if (wasActive) setDragging(false);
        return;
      }
      const dx = event.clientX - drag.startX;
      if (!drag.active) {
        if (!isDragGesture(dx)) return;
        drag.active = true;
        // Losing capture only degrades the drag once the pointer leaves the element.
        try {
          el.setPointerCapture(event.pointerId);
        } catch {
          // Swallowed: continue the drag without pointer capture.
        }
        setDragging(true);
      }
      // The 5 px threshold is caught up in this one move (standard).
      el.scrollLeft = clampScroll(drag.startScroll - dx, maxScroll(el));
      drag.samples.push({ t: event.timeStamp, x: event.clientX });
      const cutoff = event.timeStamp - VELOCITY_WINDOW_MS;
      while (drag.samples.length > 1) {
        const oldest = drag.samples[0];
        if (oldest === undefined || oldest.t >= cutoff) break;
        drag.samples.shift();
      }
      event.preventDefault();
    },
    [ref],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (drag?.pointerId !== event.pointerId) return;
      const el = ref.current;
      dragRef.current = null;
      // Never became a drag → it was a click; the chip's `onClick` runs.
      if (!drag.active) return;
      setDragging(false);
      suppressClickRef.current = true;
      // The `click` is dispatched in the same task right after `pointerup`;
      // the timeout clears the flag even when no click comes (a release
      // outside the window), so a later keyboard Enter/Space is never
      // swallowed.
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      // Negated: moving the pointer right scrolls left.
      const v = -releaseVelocity(drag.samples, event.timeStamp);
      if (
        el !== null &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        startMomentum(el.scrollLeft, v);
      }
    },
    [ref, startMomentum],
  );

  const onPointerCancel = useCallback(() => {
    const drag = dragRef.current;
    if (drag === null) return;
    dragRef.current = null;
    if (drag.active) setDragging(false);
    // No momentum and no click suppression: no click follows a cancel.
  }, []);

  const onClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (suppressClickRef.current) {
      // React runs the ancestor's capture handler before the chip's
      // `onClick`, so the chip never toggles after a real drag.
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    // Window, capture, passive: runs before the strip's own handler and only
    // records who owns the current gesture (the latch). Passive, so page
    // scrolling is never slowed.
    const onAnyWheel = (event: WheelEvent): void => {
      wheelGestureRef.current = wheelGestureOwner(
        wheelGestureRef.current,
        event.timeStamp,
        event.target instanceof Node && el.contains(event.target),
      );
    };
    // The strip, non-passive: React's `onWheel` is passive and could not
    // `preventDefault`.
    const onWheel = (event: WheelEvent): void => {
      stopMomentum();
      if (!event.cancelable || wheelGestureRef.current?.owner !== 'strip') {
        return;
      }
      const delta = wheelScrollDelta(event, el.clientWidth);
      if (!consumesWheel(el, delta)) return;
      event.preventDefault();
      el.scrollLeft = clampScroll(el.scrollLeft + delta, maxScroll(el));
    };
    window.addEventListener('wheel', onAnyWheel, {
      capture: true,
      passive: true,
    });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', onAnyWheel, { capture: true });
      el.removeEventListener('wheel', onWheel);
    };
  }, [ref, stopMomentum]);

  // A running glide must not outlive the strip.
  useEffect(() => stopMomentum, [stopMomentum]);

  return {
    dragging,
    stopMomentum,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
  };
}
