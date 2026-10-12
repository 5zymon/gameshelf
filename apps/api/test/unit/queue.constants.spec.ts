import {
  PHOTO_IMPORT_CONCURRENCY,
  PHOTO_IMPORT_QUEUE,
} from '../../src/queue/queue.constants';

describe('photo-import queue constants (unit)', () => {
  // Regressing this assertion means someone raised the concurrency: ADR-005
  // pins it to 1, and raising it REQUIRES a new ADR superseding ADR-005.
  it('pins concurrency to exactly 1', () => {
    expect(PHOTO_IMPORT_CONCURRENCY).toBe(1);
  });

  it('uses the single photo-import queue name', () => {
    expect(PHOTO_IMPORT_QUEUE).toBe('photo-import');
  });
});
