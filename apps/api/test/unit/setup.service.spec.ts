import { Logger } from '@nestjs/common';
import type { UsersService } from '../../src/auth/users.service';
import { SetupService } from '../../src/setup/setup.service';
import { testId } from '../helpers/ids';

interface UsersMock {
  hasAnyUser: jest.Mock;
  createFirstUser: jest.Mock;
}

function createService(): { service: SetupService; users: UsersMock } {
  const users: UsersMock = {
    hasAnyUser: jest.fn(),
    createFirstUser: jest.fn(),
  };
  return {
    service: new SetupService(users as unknown as UsersService),
    users,
  };
}

describe('SetupService (unit)', () => {
  let service: SetupService;
  let users: UsersMock;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    ({ service, users } = createService());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('status', () => {
    it('reports setup required when no user exists', async () => {
      users.hasAnyUser.mockResolvedValue(false);

      await expect(service.status()).resolves.toEqual({ setupRequired: true });
    });

    it('reports setup complete when a user exists', async () => {
      users.hasAnyUser.mockResolvedValue(true);

      await expect(service.status()).resolves.toEqual({ setupRequired: false });
    });
  });

  describe('setup', () => {
    it('delegates to createFirstUser and returns the created user', async () => {
      const createdAt = new Date('2026-10-05T12:00:00.000Z');
      const created = { id: testId(1), email: 'ash@example.com', createdAt };
      users.createFirstUser.mockResolvedValue(created);
      const dto = { email: 'Ash@Example.com', password: 'pikachu123' };

      await expect(service.setup(dto)).resolves.toEqual(created);
      expect(users.createFirstUser).toHaveBeenCalledWith(dto);
      expect(logSpy).toHaveBeenCalledWith(
        `First-run setup completed: created user ${testId(1)} (ash@example.com)`,
      );
    });
  });
});
