import { BadRequestException, ConflictException } from '@nestjs/common';
import { PasswordService } from '../../src/auth/password.service';
import { UsersService } from '../../src/auth/users.service';
import { Prisma } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';

interface UsersPrismaMock {
  user: {
    create: jest.Mock;
  };
}

interface PasswordsMock {
  hash: jest.Mock;
}

function createService(): {
  service: UsersService;
  prisma: UsersPrismaMock;
  passwords: PasswordsMock;
} {
  const prisma: UsersPrismaMock = { user: { create: jest.fn() } };
  const passwords: PasswordsMock = { hash: jest.fn() };
  return {
    service: new UsersService(
      prisma as unknown as PrismaService,
      passwords as unknown as PasswordService,
    ),
    prisma,
    passwords,
  };
}

function knownError(
  code: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('mock error', {
    code,
    clientVersion: '7.10.0',
    meta,
  });
}

describe('UsersService (unit)', () => {
  let service: UsersService;
  let prisma: UsersPrismaMock;
  let passwords: PasswordsMock;

  beforeEach(() => {
    ({ service, prisma, passwords } = createService());
  });

  it('normalizes the email and stores only the hash', async () => {
    const createdAt = new Date('2026-10-05T12:00:00.000Z');
    passwords.hash.mockResolvedValue('ARGON2HASH');
    prisma.user.create.mockResolvedValue({
      id: 1,
      email: 'ash@example.com',
      createdAt,
    });

    const result = await service.createUser({
      email: '  Ash@Example.COM ',
      password: 'pikachu123',
    });

    expect(passwords.hash).toHaveBeenCalledWith('pikachu123');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: 'ash@example.com', passwordHash: 'ARGON2HASH' },
      select: { id: true, email: true, createdAt: true },
    });
    expect(result).toEqual({ id: 1, email: 'ash@example.com', createdAt });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('rejects a blank (whitespace-only) email without hashing', async () => {
    await expect(
      service.createUser({ email: '   ', password: 'pikachu123' }),
    ).rejects.toThrow(new BadRequestException('email must not be blank'));
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects an empty password without hashing', async () => {
    await expect(
      service.createUser({ email: 'ash@example.com', password: '' }),
    ).rejects.toThrow(new BadRequestException('password must not be empty'));
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('maps a P2002 unique violation to 409', async () => {
    passwords.hash.mockResolvedValue('ARGON2HASH');
    prisma.user.create.mockRejectedValue(
      knownError('P2002', { target: ['email'] }),
    );

    await expect(
      service.createUser({ email: 'ash@example.com', password: 'pikachu123' }),
    ).rejects.toThrow(
      new ConflictException(
        'A user with email "ash@example.com" already exists',
      ),
    );
  });
});
