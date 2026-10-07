import { CoverRecoveryService } from '../../src/covers/cover-recovery.service';
import { CoverSweepService } from '../../src/covers/cover-sweep.service';

function harness() {
  const recovery = { retryMissing: jest.fn(() => Promise.resolve(0)) };
  return {
    service: new CoverSweepService(recovery as unknown as CoverRecoveryService),
    recovery,
  };
}

describe('CoverSweepService (unit)', () => {
  it('delegates a sweep to the recovery service', async () => {
    const h = harness();
    h.recovery.retryMissing.mockResolvedValue(3);

    await h.service.sweep();

    expect(h.recovery.retryMissing).toHaveBeenCalledTimes(1);
  });

  it('swallows and logs a recovery error', async () => {
    const h = harness();
    h.recovery.retryMissing.mockRejectedValue(new Error('db down'));

    await expect(h.service.sweep()).resolves.toBeUndefined();
  });
});
