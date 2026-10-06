import { type IgdbHealth } from '../../src/game-catalog/igdb.client';
import { IgdbHealthController } from '../../src/game-catalog/igdb-health.controller';
import { IgdbHealthService } from '../../src/game-catalog/igdb-health.service';

function controllerWith(health: IgdbHealth): IgdbHealthController {
  const service = {
    check: jest.fn().mockResolvedValue(health),
  } as unknown as IgdbHealthService;
  return new IgdbHealthController(service);
}

describe('IgdbHealthController (unit)', () => {
  it('returns the service body', async () => {
    const health: IgdbHealth = { status: 'ok', token: 'acquired' };

    await expect(controllerWith(health).getIgdbHealth()).resolves.toBe(health);
  });

  it('resolves an error body rather than throwing', async () => {
    const health: IgdbHealth = {
      status: 'error',
      token: 'error',
      message: 'IGDB status check failed',
    };

    await expect(controllerWith(health).getIgdbHealth()).resolves.toEqual(
      health,
    );
  });

  it('returns the error body when the service itself rejects', async () => {
    const service = {
      check: jest.fn().mockRejectedValue(new Error('unexpected')),
    } as unknown as IgdbHealthService;

    await expect(
      new IgdbHealthController(service).getIgdbHealth(),
    ).resolves.toEqual({
      status: 'error',
      token: 'error',
      message: 'IGDB status check failed',
    });
  });
});
