import { ServiceUnavailableException } from '@nestjs/common';
import { QueueHealthController } from '../../src/queue/queue-health.controller';
import type { QueueHealthService } from '../../src/queue/queue-health.service';

/**
 * The endpoint is unauthenticated, so a failure must not echo the underlying
 * error (which can include host names / connection detail).
 */
describe('QueueHealthController (unit)', () => {
  it('returns a static message and does not leak the underlying error', async () => {
    const service = {
      getHealth: jest
        .fn()
        .mockRejectedValue(
          new Error('connect ECONNREFUSED 127.0.0.1:6379 secret-host'),
        ),
    } as unknown as QueueHealthService;
    const controller = new QueueHealthController(service);

    const error = await controller
      .getQueueHealth()
      .then(() => undefined)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as Error).message).toBe('Queue health check failed');
    expect((error as Error).message).not.toContain('ECONNREFUSED');
    expect((error as Error).message).not.toContain('secret-host');
  });
});
