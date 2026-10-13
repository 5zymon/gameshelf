/** Deterministic valid UUIDv7 fixtures; lexical order follows n. */
export function testId(n: number): string {
  return `01900000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
}
export const MISSING_ID = testId(0xffffff);
export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
