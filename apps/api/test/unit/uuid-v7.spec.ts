import { isUUID } from 'class-validator';
import { uuidv7 } from '../../src/common/uuid-v7';

describe('uuidv7 (unit)', () => {
  it('emits a lowercase RFC 9562 UUIDv7', () => {
    const value = uuidv7();

    expect(isUUID(value, '7')).toBe(true);
    expect(value).toBe(value.toLowerCase());
  });

  it('encodes the timestamp into the first 48 bits', () => {
    expect(uuidv7(0x0192_6f3a_8c4e).startsWith('01926f3a-8c4e-7')).toBe(true);
  });

  it('returns 1000 unique values', () => {
    const values = new Set(Array.from({ length: 1000 }, () => uuidv7()));

    expect(values.size).toBe(1000);
  });
});
