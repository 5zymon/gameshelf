/**
 * Roving-focus target for a WAI-ARIA tablist key press, or `null` if the key is
 * not handled. Kept pure and DOM-free so the `node --test` harness (no React,
 * no DOM) can pin the wrap-around and Home/End behaviour.
 *
 * `ArrowRight`/`ArrowLeft` move one tab and wrap; `Home`/`End` jump to the
 * first/last tab; any other key — or an empty list — is not handled.
 */
export function nextTabIndex(
  current: number,
  key: string,
  count: number,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
