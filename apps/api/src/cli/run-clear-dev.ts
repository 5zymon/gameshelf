import type { DevDataCounts } from './dev-data';
import type { LineReader } from './prompt';

/** Injected side effects, so the CLI body is testable without Nest or a DB. */
export interface ClearDevCliDeps {
  nodeEnv: string | undefined;
  force: boolean;
  interactive: boolean;
  /** Host and database being cleared, shown in the confirmation header. */
  target: string;
  count: () => Promise<DevDataCounts>;
  clear: () => Promise<DevDataCounts>;
  readLine: LineReader;
  out: (line: string) => void;
  err: (line: string) => void;
}

/**
 * Host and database name from a connection URL, for the "which database am I
 * about to wipe" header. Deliberately drops the userinfo: a `DATABASE_URL` can
 * carry a password, and this text is printed to stdout (and may land in CI
 * logs). `mysql://…` URLs parse as protocol + hostname + port + pathname.
 * Falls back to `<unknown>` when the URL is unset or unparseable.
 */
export function describeDatabaseTarget(url: string | undefined): string {
  if (url === undefined || url.trim() === '') {
    return '<unknown>';
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname === '') {
      return '<unknown>';
    }
    const database = parsed.pathname.replace(/^\/+/, '');
    const port = parsed.port === '' ? '' : `:${parsed.port}`;
    return database === ''
      ? `${parsed.hostname}${port}`
      : `${database}@${parsed.hostname}${port}`;
  } catch {
    return '<unknown>';
  }
}

function formatCounts(counts: DevDataCounts): string {
  return (
    `games=${String(counts.games)} images=${String(counts.gameImages)} ` +
    `videos=${String(counts.gameVideos)} importJobs=${String(counts.importJobs)} ` +
    `recognized=${String(counts.recognizedItems)} ` +
    `unrecognized=${String(counts.unrecognizedItems)} ` +
    `importPlatforms=${String(counts.importPlatforms)}`
  );
}

/**
 * Deletes dev game/import data behind a `NODE_ENV=development` gate and a
 * confirmation prompt. Returns the process exit code: `0` on success or a
 * declined prompt, `1` when the environment is wrong, there is no terminal to
 * confirm on, or a query throws.
 */
export async function runClearDevCli(deps: ClearDevCliDeps): Promise<number> {
  if (deps.nodeEnv !== 'development') {
    deps.err(
      `Error: db:clear-dev only runs with NODE_ENV=development (current: ${
        deps.nodeEnv ?? 'unset'
      }).`,
    );
    return 1;
  }
  if (!deps.force && !deps.interactive) {
    deps.err('Error: refusing to clear without a terminal; pass --force.');
    return 1;
  }
  try {
    if (!deps.force) {
      const counts = await deps.count();
      deps.out(`About to clear ${deps.target}:`);
      deps.out(formatCounts(counts));
      const answer = (await deps.readLine('Type "yes" to delete: ')).trim();
      if (answer !== 'yes') {
        deps.out('Aborted; nothing was deleted.');
        return 0;
      }
    }
    const result = await deps.clear();
    deps.out(`Dev data cleared: ${formatCounts(result)}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.err(`Error: ${message}`);
    return 1;
  }
}
