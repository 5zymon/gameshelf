import { randomBytes } from 'node:crypto';

/** A valid UUIDv7 used as the Swagger example for every id. */
export const UUID_V7_EXAMPLE = '01926f3a-8c4e-7b21-9d3f-2a6b8e4c1f70';

/**
 * RFC 9562 UUIDv7 (48-bit Unix ms timestamp, version 7, variant 10, random
 * rest), lowercase like Prisma's `@default(uuid(7))`. Only for raw SQL inserts,
 * which bypass Prisma's generated default (ADR-006).
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
