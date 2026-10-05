import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_SESSION_TTL_MINUTES,
  loadAuthConfig,
} from '../../src/auth/auth.config';

const SECRET = 'a'.repeat(40);

function config(values: Record<string, string>): ConfigService {
  return new ConfigService(values);
}

describe('loadAuthConfig (unit)', () => {
  it('parses a valid secret and TTL', () => {
    const result = loadAuthConfig(
      config({ SESSION_SECRET: SECRET, SESSION_TTL_MINUTES: '120' }),
    );

    expect(result).toEqual({ sessionSecret: SECRET, sessionTtlMs: 7_200_000 });
  });

  it('defaults a missing SESSION_TTL_MINUTES to 7 days', () => {
    const result = loadAuthConfig(config({ SESSION_SECRET: SECRET }));

    expect(result.sessionTtlMs).toBe(DEFAULT_SESSION_TTL_MINUTES * 60_000);
  });

  it('defaults an empty SESSION_TTL_MINUTES to 7 days', () => {
    const result = loadAuthConfig(
      config({ SESSION_SECRET: SECRET, SESSION_TTL_MINUTES: '' }),
    );

    expect(result.sessionTtlMs).toBe(DEFAULT_SESSION_TTL_MINUTES * 60_000);
  });

  it('throws when SESSION_SECRET is missing', () => {
    expect(() =>
      loadAuthConfig(config({ SESSION_TTL_MINUTES: '120' })),
    ).toThrow();
  });

  it('throws when SESSION_SECRET is shorter than 32 characters', () => {
    expect(() =>
      loadAuthConfig(
        config({ SESSION_SECRET: 'a'.repeat(31), SESSION_TTL_MINUTES: '120' }),
      ),
    ).toThrow();
  });

  it.each(['0', '-1', 'abc', '1.5', '525601'])(
    'rejects SESSION_TTL_MINUTES=%s (finite only, no "never")',
    (value) => {
      expect(() =>
        loadAuthConfig(
          config({ SESSION_SECRET: SECRET, SESSION_TTL_MINUTES: value }),
        ),
      ).toThrow();
    },
  );
});
