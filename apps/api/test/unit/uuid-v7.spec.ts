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

  it('pins the RFC 9562 layout for a fixed timestamp (version 7, variant 10)', () => {
    const value = uuidv7(0x0192_6f3a_8c4e);

    expect(value[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(value[19]);
  });

  it('sorts lexically after an earlier timestamp', () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_001_000);

    expect(earlier < later).toBe(true);
  });

  it('returns 1000 unique values', () => {
    const values = new Set(Array.from({ length: 1000 }, () => uuidv7()));

    expect(values.size).toBe(1000);
  });
});
