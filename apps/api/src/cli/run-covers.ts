import type { CoverRecoveryResult } from '../covers/cover-recovery.service';

/** Injected side effects, so the CLI body is testable without Nest or a DB. */
export interface CoversCliDeps {
  redownload: () => Promise<CoverRecoveryResult>;
  out: (line: string) => void;
  err: (line: string) => void;
}

/**
 * Re-downloads every missing cover from its stored game-database link and
 * prints a one-line summary. Returns the process exit code: `0` when nothing
 * failed, `1` when a download failed or the command threw.
 */
export async function runCoversCli(deps: CoversCliDeps): Promise<number> {
  try {
    const result = await deps.redownload();
    deps.out(
      `Covers re-downloaded: total=${String(result.total)} ` +
        `downloaded=${String(result.downloaded)} ` +
        `present=${String(result.alreadyPresent)} ` +
        `failed=${String(result.failed)} noSource=${String(result.noSource)}`,
    );
    return result.failed === 0 ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.err(`Error: ${message}`);
    return 1;
  }
}
