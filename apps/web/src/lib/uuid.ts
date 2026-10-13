/** Mirrors the API's `@IsUUID('7')` (RFC 9562 UUIDv7, any case). */
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuidV7(value: string): boolean {
  return UUID_V7.test(value);
}
