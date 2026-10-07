import {
  MobygamesConfigError,
  MobygamesError,
  mobygamesErrorFromStatus,
} from '../../src/game-catalog/mobygames.errors';

describe('mobygamesErrorFromStatus (unit)', () => {
  it.each([401, 403])(
    'maps %i (credentials rejected) to a permanent config error',
    (status) => {
      const error = mobygamesErrorFromStatus(status);

      expect(error).toBeInstanceOf(MobygamesError);
      expect(error).toBeInstanceOf(MobygamesConfigError);
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('MobyGames rejected the credentials');
    },
  );

  it('maps 429 to a retryable rate-limit error', () => {
    const error = mobygamesErrorFromStatus(429);

    expect(error).toBeInstanceOf(MobygamesError);
    expect(error).not.toBeInstanceOf(MobygamesConfigError);
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('MobyGames rate-limited the request');
  });

  it.each([500, 502, 503])('maps %i to a retryable server error', (status) => {
    const error = mobygamesErrorFromStatus(status);

    expect(error.retryable).toBe(true);
    expect(error.message).toBe('MobyGames returned a server error');
  });

  it.each([400, 404, 422])(
    'maps %i to a permanent request error naming the status',
    (status) => {
      const error = mobygamesErrorFromStatus(status);

      expect(error.retryable).toBe(false);
      expect(error.message).toBe(
        `MobyGames rejected the request (HTTP ${String(status)})`,
      );
    },
  );

  it('never embeds credentials or response bodies in its messages', () => {
    const secret = 'moby-super-secret';
    const messages = [400, 401, 403, 404, 429, 500, 503].map(
      (status) => mobygamesErrorFromStatus(status).message,
    );

    for (const message of messages) {
      expect(message).not.toContain(secret);
      expect(message).not.toContain('api_key');
    }
  });
});
