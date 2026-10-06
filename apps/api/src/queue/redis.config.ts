import { ConfigService } from '@nestjs/config';

/** Defaults documented in README / .env.example. */
export const DEFAULT_REDIS_HOST = 'localhost';
export const DEFAULT_REDIS_PORT = 6379;

/**
 * BullMQ's own default key prefix. Queue keys are `"<prefix>:<queue>:..."`, so
 * a distinct prefix gives a queue its own keyspace in a shared Redis.
 */
export const DEFAULT_QUEUE_PREFIX = 'bull';

/** Connection options handed to BullMQ/ioredis. */
export interface RedisConnection {
  host: string;
  port: number;
  /**
   * BullMQ requires worker connections to retry commands indefinitely;
   * one shared config backs both the Queue and the Worker.
   */
  maxRetriesPerRequest: null;
}

/** Reads an env var, treating an undefined or blank value as absent. */
function readEnv(config: ConfigService, key: string): string | undefined {
  const raw = config.get<string>(key);
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  return raw.trim();
}

/**
 * Loads the Redis connection from REDIS_HOST / REDIS_PORT only. REDIS_URL is
 * deliberately ignored so the connection source is unambiguous.
 */
export function loadRedisConnection(config: ConfigService): RedisConnection {
  const host = readEnv(config, 'REDIS_HOST') ?? DEFAULT_REDIS_HOST;
  const rawPort = readEnv(config, 'REDIS_PORT');
  const port = rawPort === undefined ? DEFAULT_REDIS_PORT : parsePort(rawPort);

  return { host, port, maxRetriesPerRequest: null };
}

/**
 * Redis key prefix (namespace) for BullMQ from REDIS_QUEUE_PREFIX. Defaults to
 * BullMQ's own `bull`. This is a namespace, not a connection setting: host and
 * port still come only from REDIS_HOST / REDIS_PORT.
 */
export function loadQueuePrefix(config: ConfigService): string {
  return readEnv(config, 'REDIS_QUEUE_PREFIX') ?? DEFAULT_QUEUE_PREFIX;
}

/**
 * Strict decimal parsing: `Number()` alone accepts "0x10" (16) and "1e3"
 * (1000). Surrounding whitespace is trimmed by the caller.
 */
function parsePort(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `REDIS_PORT must be an integer between 1 and 65535 (got "${raw}")`,
    );
  }
  const port = Number(raw);
  if (port < 1 || port > 65_535) {
    throw new Error(
      `REDIS_PORT must be an integer between 1 and 65535 (got "${raw}")`,
    );
  }
  return port;
}
