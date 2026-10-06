import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_QUEUE_PREFIX,
  DEFAULT_REDIS_HOST,
  DEFAULT_REDIS_PORT,
  loadQueuePrefix,
  loadRedisConnection,
} from '../../src/queue/redis.config';

function config(values: Record<string, string>): ConfigService {
  return new ConfigService(values);
}

// The CI test step and the local e2e tier export REDIS_HOST/REDIS_PORT for the
// whole test run. ConfigService falls back to process.env, so clear them here:
// each case must be determined solely by the values passed to `config`.
const ambientRedisHost = process.env.REDIS_HOST;
const ambientRedisPort = process.env.REDIS_PORT;
const ambientQueuePrefix = process.env.REDIS_QUEUE_PREFIX;

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

beforeAll(() => {
  delete process.env.REDIS_HOST;
  delete process.env.REDIS_PORT;
  delete process.env.REDIS_QUEUE_PREFIX;
});

afterAll(() => {
  restore('REDIS_HOST', ambientRedisHost);
  restore('REDIS_PORT', ambientRedisPort);
  restore('REDIS_QUEUE_PREFIX', ambientQueuePrefix);
});

describe('loadRedisConnection (unit)', () => {
  it('defaults host and port when both are absent', () => {
    expect(loadRedisConnection(config({}))).toEqual({
      host: DEFAULT_REDIS_HOST,
      port: DEFAULT_REDIS_PORT,
      maxRetriesPerRequest: null,
    });
  });

  it('parses explicit host and port', () => {
    expect(
      loadRedisConnection(
        config({ REDIS_HOST: 'redis.internal', REDIS_PORT: '6380' }),
      ),
    ).toEqual({
      host: 'redis.internal',
      port: 6380,
      maxRetriesPerRequest: null,
    });
  });

  it('treats empty strings as absent and falls back to defaults', () => {
    expect(
      loadRedisConnection(config({ REDIS_HOST: '', REDIS_PORT: '' })),
    ).toEqual({
      host: DEFAULT_REDIS_HOST,
      port: DEFAULT_REDIS_PORT,
      maxRetriesPerRequest: null,
    });
  });

  it('ignores REDIS_URL — the connection comes from host/port only', () => {
    expect(
      loadRedisConnection(
        config({ REDIS_URL: 'redis://redis.example.com:7000' }),
      ),
    ).toEqual({
      host: DEFAULT_REDIS_HOST,
      port: DEFAULT_REDIS_PORT,
      maxRetriesPerRequest: null,
    });
  });

  it.each(['0', '-1', 'abc', '1.5', '65536', '0x10', '1e3'])(
    'rejects REDIS_PORT=%s (strict integer in 1..65535 only)',
    (value) => {
      expect(() =>
        loadRedisConnection(config({ REDIS_PORT: value })),
      ).toThrow();
    },
  );

  it('accepts a padded REDIS_PORT after trimming', () => {
    expect(loadRedisConnection(config({ REDIS_PORT: ' 6379 ' }))).toMatchObject(
      { port: 6379 },
    );
  });
});

describe('loadQueuePrefix (unit)', () => {
  it('defaults to BullMQ’s "bull" prefix when absent', () => {
    expect(loadQueuePrefix(config({}))).toBe(DEFAULT_QUEUE_PREFIX);
    expect(DEFAULT_QUEUE_PREFIX).toBe('bull');
  });

  it('reads a custom prefix from REDIS_QUEUE_PREFIX', () => {
    expect(loadQueuePrefix(config({ REDIS_QUEUE_PREFIX: 'bull-e2e' }))).toBe(
      'bull-e2e',
    );
  });

  it('treats a blank prefix as absent and falls back to the default', () => {
    expect(loadQueuePrefix(config({ REDIS_QUEUE_PREFIX: '   ' }))).toBe(
      DEFAULT_QUEUE_PREFIX,
    );
  });
});
