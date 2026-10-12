/**
 * Client-side id helper.
 *
 * `crypto.randomUUID` is only available in secure contexts (HTTPS or
 * localhost). When the app is served over plain HTTP on a LAN IP, the global
 * `crypto` object exists but `randomUUID` is `undefined`, so calling it
 * throws `TypeError: crypto.randomUUID is not a function`.
 *
 * The ids produced here are strictly client-side: they serve as React keys,
 * DOM id fragments (e.g. `count-${id}`), and keys for in-memory maps inside
 * the photo import form. They are never sent to the backend, so a
 * non-cryptographic fallback is acceptable.
 */

let counter = 0;

/**
 * Fallback id generator for non-secure contexts.
 *
 * Shape: `id-<timestamp36>-<counter36>-<random36>` — unique per page session,
 * no whitespace, starts with a letter (required because the value is
 * interpolated into DOM ids such as `count-${id}`).
 */
export function randomClientId(): string {
  return `id-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returns a unique client-side id, preferring `crypto.randomUUID` when
 * available (secure context) and falling back to {@link randomClientId}
 * otherwise.
 */
export function createClientId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return randomClientId();
}
