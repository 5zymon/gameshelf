import { UnauthorizedException } from '@nestjs/common';
import {
  AuthService,
  DUMMY_PASSWORD_HASH,
  INVALID_CREDENTIALS_MESSAGE,
} from '../../src/auth/auth.service';
import type { PasswordService } from '../../src/auth/password.service';
import type { SessionsService } from '../../src/auth/sessions.service';
import type { UsersService } from '../../src/auth/users.service';
import { testId } from '../helpers/ids';

interface UsersMock {
  findByEmail: jest.Mock;
  findById: jest.Mock;
}

interface PasswordsMock {
  verify: jest.Mock;
}

interface SessionsMock {
  create: jest.Mock;
  revoke: jest.Mock;
}

const USER = {
  id: testId(7),
  email: 'ash@example.com',
  passwordHash: 'ARGON2HASH',
  language: 'pl',
  theme: 'system',
  createdAt: new Date('2026-10-05T12:00:00.000Z'),
};

function createService(): {
  service: AuthService;
  users: UsersMock;
  passwords: PasswordsMock;
  sessions: SessionsMock;
} {
  const users: UsersMock = { findByEmail: jest.fn(), findById: jest.fn() };
  const passwords: PasswordsMock = { verify: jest.fn() };
  const sessions: SessionsMock = { create: jest.fn(), revoke: jest.fn() };
  return {
    service: new AuthService(
      users as unknown as UsersService,
      passwords as unknown as PasswordService,
      sessions as unknown as SessionsService,
    ),
    users,
    passwords,
    sessions,
  };
}

describe('AuthService (unit)', () => {
  let service: AuthService;
  let users: UsersMock;
  let passwords: PasswordsMock;
  let sessions: SessionsMock;

  beforeEach(() => {
    ({ service, users, passwords, sessions } = createService());
  });

  it('logs in a valid user and creates a session with the userAgent', async () => {
    const expiresAt = new Date('2026-10-06T12:00:00.000Z');
    users.findByEmail.mockResolvedValue(USER);
    passwords.verify.mockResolvedValue(true);
    sessions.create.mockResolvedValue({ token: 'token', expiresAt });

    const result = await service.login(
      'ash@example.com',
      'pikachu123',
      'jest-agent',
    );

    expect(users.findByEmail).toHaveBeenCalledWith('ash@example.com');
    expect(passwords.verify).toHaveBeenCalledWith('ARGON2HASH', 'pikachu123');
    expect(sessions.create).toHaveBeenCalledWith(testId(7), {
      userAgent: 'jest-agent',
    });
    expect(result).toEqual({
      user: {
        id: testId(7),
        email: 'ash@example.com',
        language: 'pl',
        theme: 'system',
        createdAt: USER.createdAt,
      },
      token: 'token',
      expiresAt,
    });
  });

  it('verifies against the dummy hash for an unknown email', async () => {
    users.findByEmail.mockResolvedValue(null);
    passwords.verify.mockResolvedValue(false);

    await expect(
      service.login('nobody@example.com', 'whatever'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(passwords.verify).toHaveBeenCalledWith(
      DUMMY_PASSWORD_HASH,
      'whatever',
    );
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('AC7: unknown email and wrong password are indistinguishable 401s', async () => {
    users.findByEmail.mockResolvedValue(null);
    passwords.verify.mockResolvedValue(false);
    const unknown = await service
      .login('nobody@example.com', 'whatever')
      .catch((error: unknown) => error);

    users.findByEmail.mockResolvedValue(USER);
    passwords.verify.mockResolvedValue(false);
    const wrong = await service
      .login('ash@example.com', 'wrong-password')
      .catch((error: unknown) => error);

    expect(unknown).toBeInstanceOf(UnauthorizedException);
    expect(wrong).toBeInstanceOf(UnauthorizedException);
    expect((unknown as UnauthorizedException).getStatus()).toBe(401);
    expect((wrong as UnauthorizedException).getStatus()).toBe(401);
    expect((unknown as UnauthorizedException).message).toBe(
      INVALID_CREDENTIALS_MESSAGE,
    );
    expect((wrong as UnauthorizedException).message).toBe(
      INVALID_CREDENTIALS_MESSAGE,
    );
  });

  it('me() returns the user and 401s when the user is gone', async () => {
    users.findById.mockResolvedValue(USER);
    await expect(service.me(testId(7))).resolves.toEqual(USER);

    users.findById.mockResolvedValue(null);
    await expect(service.me(testId(7))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('coerces a corrupt stored language and theme to the defaults in login and me', async () => {
    const corrupt = { ...USER, language: 'xx', theme: 'yy' };
    users.findByEmail.mockResolvedValue(corrupt);
    passwords.verify.mockResolvedValue(true);
    sessions.create.mockResolvedValue({
      token: 'token',
      expiresAt: new Date('2026-10-06T12:00:00.000Z'),
    });

    const result = await service.login('ash@example.com', 'pikachu123');
    expect(result.user.language).toBe('en');
    expect(result.user.theme).toBe('system');

    users.findById.mockResolvedValue(corrupt);
    await expect(service.me(testId(7))).resolves.toEqual({
      ...corrupt,
      language: 'en',
      theme: 'system',
    });
  });

  it('logout() revokes the session token', async () => {
    sessions.revoke.mockResolvedValue(undefined);

    await service.logout('token');

    expect(sessions.revoke).toHaveBeenCalledWith('token');
  });
});
