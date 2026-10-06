import type { PlatformSyncResult } from '../platforms/platforms-sync.service';

/** Injected side effects, so the CLI body is testable without Nest or a DB. */
export interface PlatformsCliDeps {
  sync: () => Promise<PlatformSyncResult>;
  out: (line: string) => void;
  err: (line: string) => void;
}

/**
 * Runs one platform sync and prints a one-line summary. Returns the process
 * exit code: `0` on success, `1` when the sync throws (e.g. missing IGDB
 * credentials), with the error message written to `err`.
 */
export async function runPlatformsCli(deps: PlatformsCliDeps): Promise<number> {
  try {
    const result = await deps.sync();
    deps.out(
      `Platforms synced: fetched=${String(result.fetched)} ` +
        `created=${String(result.created)} updated=${String(result.updated)} ` +
        `unchanged=${String(result.unchanged)}`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.err(`Error: ${message}`);
    return 1;
  }
}
