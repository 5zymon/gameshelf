import { SEED_QA_USER } from './seed-data';
import type { SeedResult } from './seed-data';

/** Injected side effects, so the CLI body is testable without Nest or a DB. */
export interface SeedCliDeps {
  nodeEnv: string | undefined;
  /** Host and database being seeded, shown in the header. */
  target: string;
  seed: () => Promise<SeedResult>;
  out: (line: string) => void;
  err: (line: string) => void;
}

/**
 * Seeds the QA account and the sample catalog behind a
 * `NODE_ENV=development` gate. Returns the process exit code: `0` on success,
 * `1` when the environment is wrong or a query throws.
 *
 * Printing the QA password is deliberate: it is a documented dev-only constant
 * and the gate prevents it from running anywhere else.
 */
export async function runSeedCli(deps: SeedCliDeps): Promise<number> {
  if (deps.nodeEnv !== 'development') {
    deps.err(
      `Error: db:seed only runs with NODE_ENV=development (current: ${
        deps.nodeEnv ?? 'unset'
      }).`,
    );
    return 1;
  }
  deps.out(`Seeding ${deps.target}`);
  try {
    const r = await deps.seed();
    deps.out(
      `Dev data seeded: user=${r.user} ` +
        `platformsCreated=${String(r.platformsCreated)} ` +
        `platformsReused=${String(r.platformsReused)} ` +
        `gamesCreated=${String(r.gamesCreated)} ` +
        `gamesSkipped=${String(r.gamesSkipped)}`,
    );
    deps.out(`QA account: ${SEED_QA_USER.email} / ${SEED_QA_USER.password}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.err(`Error: ${message}`);
    return 1;
  }
}
