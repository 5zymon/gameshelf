import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client';

/** How long the API waits for the database before giving up at boot. */
const DB_READY_TIMEOUT_MS = 120_000;
/** Delay between database-readiness probes. */
const DB_READY_RETRY_MS = 2_000;
/** Pool timeouts for the throwaway probe, so a probe against a down DB fails fast. */
const DB_PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: ConfigService) {
    super({
      // Prisma 7 (Rust-free client) requires a driver adapter; `datasourceUrl`
      // was removed. The adapter accepts the raw URL and rewrites `mysql:` to
      // `mariadb:` (the mariadb driver is MySQL-compatible and parses
      // `?charset=utf8mb4`).
      adapter: new PrismaMariaDb(
        withMariadbOptions(config.getOrThrow<string>('DATABASE_URL')),
      ),
      ...(config.get<string>('PRISMA_LOG_QUERIES') === '1'
        ? { log: [{ emit: 'stdout' as const, level: 'query' as const }] }
        : {}),
    });
  }

  async onModuleInit(): Promise<void> {
    // Gate boot on database readiness: the mariadb pool never recovers from a
    // failed first connection, so a pool built while MySQL is still starting
    // keeps returning `pool timeout` for every query even after MySQL is up
    // (a plain `npm run dev` before `docker compose up -d mysql` has finished,
    // or any container restart). Probe with a throwaway client and only build
    // the long-lived pool once the database answers.
    await this.waitForDatabase();
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Retries a real authenticated query until the database answers or we time out. */
  private async waitForDatabase(): Promise<void> {
    const databaseUrl = this.config.getOrThrow<string>('DATABASE_URL');
    const deadline = Date.now() + DB_READY_TIMEOUT_MS;
    for (let attempt = 1; ; attempt += 1) {
      const probe = new PrismaClient({
        adapter: new PrismaMariaDb(
          withMariadbOptions(databaseUrl, {
            acquireTimeout: String(DB_PROBE_TIMEOUT_MS),
            connectTimeout: String(DB_PROBE_TIMEOUT_MS),
          }),
        ),
      });
      try {
        await probe.$queryRawUnsafe('SELECT 1');
        return;
      } catch (error) {
        if (Date.now() >= deadline) {
          throw new Error(
            `Database is not reachable after ${String(
              DB_READY_TIMEOUT_MS / 1000,
            )}s — is MySQL running and migrated? (${describeError(error)})`,
          );
        }
        this.logger.warn(
          `Database not ready (attempt ${String(attempt)}); retrying in ${String(
            DB_READY_RETRY_MS / 1000,
          )}s: ${describeError(error)}`,
        );
      } finally {
        await probe.$disconnect().catch(() => undefined);
      }
      await new Promise((resolve) => setTimeout(resolve, DB_READY_RETRY_MS));
    }
  }
}

/**
 * Applies the options the mariadb driver needs to the connection URL.
 *
 * `allowPublicKeyRetrieval` is required to complete the first
 * `caching_sha2_password` authentication over a plaintext connection: without
 * it the driver fails with `ER_CANNOT_RETRIEVE_RSA_KEY` whenever the server's
 * auth cache is cold (i.e. the first connection after every MySQL restart),
 * and the Prisma pool then stays stuck. The Prisma CLI (`prisma migrate`)
 * does not need this — it handles the handshake itself — but the runtime
 * driver does.
 *
 * `extra` adds per-call options (the readiness probe uses short pool timeouts).
 */
function withMariadbOptions(
  databaseUrl: string,
  extra: Record<string, string> = {},
): string {
  try {
    const url = new URL(databaseUrl);
    url.searchParams.set('allowPublicKeyRetrieval', 'true');
    for (const [key, value] of Object.entries(extra)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    // Not a URL the WHATWG parser understands: leave it untouched and let the
    // driver report the problem.
    return databaseUrl;
  }
}

/** Renders an unknown thrown value as a one-line message. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const collapsed = error.message.replace(/\s+/g, ' ').trim();
    // Prisma wraps driver errors in a multi-line `Invalid ... invocation:`
    // header; keep the driver's own message when it is there.
    const detail =
      /Raw query failed\.\s*(.*)$/.exec(collapsed)?.[1] ?? collapsed;
    return `${typeof code === 'string' ? `${code}: ` : ''}${detail}`;
  }
  return String(error);
}
