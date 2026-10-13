/** Layout metrics of a horizontal scroll container (an `HTMLElement` satisfies this). */
export interface ScrollMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/** Whether more content lies beyond the start (left) / end (right) edge. */
export interface ScrollEdges {
  start: boolean;
  end: boolean;
}

/**
 * Sub-pixel tolerance: `scrollLeft` is fractional under zoom / high-DPR while
 * `scrollWidth`/`clientWidth` are rounded integers, so an exact comparison can
 * leave a fade stuck on at either end.
 */
export const SCROLL_EDGE_EPSILON = 1;

/** LTR only. Elastic overscroll (negative / past-the-end scrollLeft) reads as "at that end". */
export function scrollEdges({
  scrollLeft,
  scrollWidth,
  clientWidth,
}: ScrollMetrics): ScrollEdges {
  const maxScroll = scrollWidth - clientWidth;
  return {
    start: scrollLeft > SCROLL_EDGE_EPSILON,
    end: scrollLeft < maxScroll - SCROLL_EDGE_EPSILON,
  };
}
