import { runCoversCli } from '../../src/cli/run-covers';

describe('runCoversCli (unit)', () => {
  it('prints a one-line summary and returns 0 when nothing failed', async () => {
    const out = jest.fn();
    const err = jest.fn();

    const code = await runCoversCli({
      redownload: () =>
        Promise.resolve({
          total: 4,
          downloaded: 3,
          alreadyPresent: 1,
          failed: 0,
          noSource: 2,
        }),
      out,
      err,
    });

    expect(code).toBe(0);
    expect(out).toHaveBeenCalledWith(
      'Covers re-downloaded: total=4 downloaded=3 present=1 failed=0 noSource=2',
    );
    expect(err).not.toHaveBeenCalled();
  });

  it('returns 1 when at least one download failed', async () => {
    const out = jest.fn();
    const err = jest.fn();

    const code = await runCoversCli({
      redownload: () =>
        Promise.resolve({
          total: 2,
          downloaded: 1,
          alreadyPresent: 0,
          failed: 1,
          noSource: 0,
        }),
      out,
      err,
    });

    expect(code).toBe(1);
    expect(out).toHaveBeenCalledTimes(1);
  });

  it('prints the error and returns 1 when the run throws', async () => {
    const out = jest.fn();
    const err = jest.fn();

    const code = await runCoversCli({
      redownload: () => Promise.reject(new Error('Database not reachable')),
      out,
      err,
    });

    expect(code).toBe(1);
    expect(err).toHaveBeenCalledWith('Error: Database not reachable');
    expect(out).not.toHaveBeenCalled();
  });
});
