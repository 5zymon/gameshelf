import { parseClearDevArgs, UsageError } from '../../src/cli/args';
import type { DevDataCounts } from '../../src/cli/dev-data';
import {
  describeDatabaseTarget,
  runClearDevCli,
  type ClearDevCliDeps,
} from '../../src/cli/run-clear-dev';

const COUNTS: DevDataCounts = {
  games: 1,
  gameImages: 2,
  gameVideos: 3,
  importJobs: 4,
  recognizedItems: 5,
  unrecognizedItems: 6,
  platforms: 7,
};

const COUNTS_LINE =
  'games=1 images=2 videos=3 importJobs=4 recognized=5 unrecognized=6 platforms=7';

const TARGET = 'gameshelf@db.internal:3306';

interface Harness {
  deps: ClearDevCliDeps;
  count: jest.Mock;
  clear: jest.Mock;
  readLine: jest.Mock;
  out: string[];
  err: string[];
}

function createHarness(overrides: Partial<ClearDevCliDeps> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const count = jest.fn().mockResolvedValue(COUNTS);
  const clear = jest.fn().mockResolvedValue(COUNTS);
  const readLine = jest.fn().mockResolvedValue('yes');
  const deps: ClearDevCliDeps = {
    nodeEnv: 'development',
    force: false,
    interactive: true,
    target: TARGET,
    count,
    clear,
    readLine,
    out: (line) => {
      out.push(line);
    },
    err: (line) => {
      err.push(line);
    },
    ...overrides,
  };
  return { deps, count, clear, readLine, out, err };
}

describe('parseClearDevArgs', () => {
  it('defaults to no force', () => {
    expect(parseClearDevArgs([])).toEqual({ force: false });
  });

  it('accepts --force', () => {
    expect(parseClearDevArgs(['--force'])).toEqual({ force: true });
  });

  it('rejects an unknown argument', () => {
    expect(() => parseClearDevArgs(['--yes'])).toThrow(UsageError);
  });
});

describe('describeDatabaseTarget', () => {
  it('keeps the host and database but drops the credentials', () => {
    const target = describeDatabaseTarget(
      'mysql://root:s3cr3t@db.internal:3306/gameshelf',
    );

    expect(target).toBe('gameshelf@db.internal:3306');
    expect(target).not.toContain('root');
    expect(target).not.toContain('s3cr3t');
  });

  it.each([undefined, '', '   ', 'not a url'])(
    'falls back to <unknown> for %j',
    (url) => {
      expect(describeDatabaseTarget(url)).toBe('<unknown>');
    },
  );
});

describe('runClearDevCli', () => {
  it.each(['production', 'test', undefined])(
    'refuses when NODE_ENV is %s without touching the database',
    async (nodeEnv) => {
      const harness = createHarness({ nodeEnv });

      const code = await runClearDevCli(harness.deps);

      expect(code).toBe(1);
      expect(harness.count).not.toHaveBeenCalled();
      expect(harness.clear).not.toHaveBeenCalled();
      expect(harness.err.join('\n')).toContain('NODE_ENV=development');
      expect(harness.err.join('\n')).toContain(nodeEnv ?? 'unset');
    },
  );

  it('clears with --force without counting or prompting', async () => {
    const harness = createHarness({ force: true, interactive: false });

    const code = await runClearDevCli(harness.deps);

    expect(code).toBe(0);
    expect(harness.clear).toHaveBeenCalledTimes(1);
    expect(harness.count).not.toHaveBeenCalled();
    expect(harness.readLine).not.toHaveBeenCalled();
    expect(harness.out).toEqual([`Dev data cleared: ${COUNTS_LINE}`]);
  });

  it('refuses without a terminal and without --force', async () => {
    const harness = createHarness({ force: false, interactive: false });

    const code = await runClearDevCli(harness.deps);

    expect(code).toBe(1);
    expect(harness.count).not.toHaveBeenCalled();
    expect(harness.clear).not.toHaveBeenCalled();
    expect(harness.err.join('\n')).toContain(
      'refusing to clear without a terminal',
    );
  });

  it('counts, prompts, and clears when the answer is yes', async () => {
    const harness = createHarness();

    const code = await runClearDevCli(harness.deps);

    expect(code).toBe(0);
    expect(harness.count).toHaveBeenCalledTimes(1);
    expect(harness.readLine).toHaveBeenCalledWith('Type "yes" to delete: ');
    expect(harness.clear).toHaveBeenCalledTimes(1);
    expect(harness.out).toEqual([
      `About to clear ${TARGET}:`,
      COUNTS_LINE,
      `Dev data cleared: ${COUNTS_LINE}`,
    ]);
  });

  it('prints the database target and never a password from the URL', async () => {
    const target = describeDatabaseTarget(
      'mysql://root:s3cr3t@db.internal:3306/gameshelf',
    );
    const harness = createHarness({ target });

    const code = await runClearDevCli(harness.deps);

    expect(code).toBe(0);
    const printed = harness.out.join('\n');
    expect(printed).toContain(target);
    expect(printed).not.toContain('s3cr3t');
    expect(printed).not.toContain('root');
  });

  it.each(['no', ''])(
    'aborts without deleting when the answer is %j',
    async (answer) => {
      const harness = createHarness({
        readLine: jest.fn().mockResolvedValue(answer),
      });

      const code = await runClearDevCli(harness.deps);

      expect(code).toBe(0);
      expect(harness.clear).not.toHaveBeenCalled();
      expect(harness.out).toContain('Aborted; nothing was deleted.');
    },
  );

  it('reports a query failure and returns 1', async () => {
    const harness = createHarness({
      force: true,
      clear: jest.fn().mockRejectedValue(new Error('Database not reachable')),
    });

    const code = await runClearDevCli(harness.deps);

    expect(code).toBe(1);
    expect(harness.err.join('\n')).toBe('Error: Database not reachable');
  });
});
