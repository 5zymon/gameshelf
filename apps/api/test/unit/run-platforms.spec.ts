import { runPlatformsCli } from '../../src/cli/run-platforms';

describe('runPlatformsCli (unit)', () => {
  it('prints a one-line summary and returns 0 on success', async () => {
    const out = jest.fn();
    const err = jest.fn();

    const code = await runPlatformsCli({
      sync: () =>
        Promise.resolve({
          fetched: 5,
          created: 2,
          updated: 1,
          unchanged: 2,
        }),
      out,
      err,
    });

    expect(code).toBe(0);
    expect(out).toHaveBeenCalledWith(
      'Platforms synced: fetched=5 created=2 updated=1 unchanged=2',
    );
    expect(err).not.toHaveBeenCalled();
  });

  it('prints the error and returns 1 when the sync throws', async () => {
    const out = jest.fn();
    const err = jest.fn();

    const code = await runPlatformsCli({
      sync: () => Promise.reject(new Error('IGDB_CLIENT_ID is not configured')),
      out,
      err,
    });

    expect(code).toBe(1);
    expect(err).toHaveBeenCalledWith('Error: IGDB_CLIENT_ID is not configured');
    expect(out).not.toHaveBeenCalled();
  });
});
