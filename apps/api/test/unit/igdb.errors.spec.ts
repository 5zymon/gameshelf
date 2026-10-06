import {
  IgdbError,
  igdbErrorFromStatus,
} from '../../src/game-catalog/igdb.errors';

describe('igdbErrorFromStatus (unit)', () => {
  it.each([401, 403])(
    'maps %i (credentials rejected) to a permanent error',
    (status) => {
      const error = igdbErrorFromStatus(status);

      expect(error).toBeInstanceOf(IgdbError);
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('IGDB rejected the credentials');
    },
  );

  it('maps 429 to a retryable rate-limit error', () => {
    const error = igdbErrorFromStatus(429);

    expect(error.retryable).toBe(true);
    expect(error.message).toBe('IGDB rate-limited the request');
  });

  it.each([500, 502, 503])('maps %i to a retryable server error', (status) => {
    const error = igdbErrorFromStatus(status);

    expect(error.retryable).toBe(true);
    expect(error.message).toBe('IGDB returned a server error');
  });

  it.each([400, 404, 422])(
    'maps %i to a permanent request error naming the status',
    (status) => {
      const error = igdbErrorFromStatus(status);

      expect(error.retryable).toBe(false);
      expect(error.message).toBe(
        `IGDB rejected the request (HTTP ${String(status)})`,
      );
    },
  );

  it('never embeds credentials or response bodies in its messages', () => {
    const secret = 'igdb-super-secret';
    const messages = [400, 401, 403, 404, 429, 500, 503].map(
      (status) => igdbErrorFromStatus(status).message,
    );

    for (const message of messages) {
      expect(message).not.toContain(secret);
      expect(message).not.toContain('client_secret');
      expect(message).not.toContain('Bearer');
    }
  });
});
