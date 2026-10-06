import {
  type IgdbHealth,
  IgdbClient,
} from '../../src/game-catalog/igdb.client';
import { IgdbHealthService } from '../../src/game-catalog/igdb-health.service';

describe('IgdbHealthService (unit)', () => {
  it('delegates to IgdbClient.checkHealth', async () => {
    const health: IgdbHealth = { status: 'ok', token: 'cached' };
    const checkHealth = jest.fn().mockResolvedValue(health);
    const service = new IgdbHealthService({
      checkHealth,
    } as unknown as IgdbClient);

    await expect(service.check()).resolves.toBe(health);
    expect(checkHealth).toHaveBeenCalledTimes(1);
  });

  it('returns an error body without throwing', async () => {
    const health: IgdbHealth = {
      status: 'error',
      token: 'error',
      message: 'IGDB rejected the credentials',
    };
    const service = new IgdbHealthService({
      checkHealth: jest.fn().mockResolvedValue(health),
    } as unknown as IgdbClient);

    await expect(service.check()).resolves.toEqual(health);
  });
});
