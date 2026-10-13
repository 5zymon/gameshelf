import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PasswordService } from '../../src/auth/password.service';
import {
  MAX_SETUP_ATTEMPTS,
  SETUP_COMPLETED_MESSAGE,
  UsersService,
} from '../../src/auth/users.service';
import { Prisma } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { testId, UUID_V7_PATTERN } from '../helpers/ids';

interface UsersPrismaMock {
  user: {
    create: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
  };
  $executeRaw: jest.Mock;
}

interface PasswordsMock {
  hash: jest.Mock;
}

function createService(): {
  service: UsersService;
  prisma: UsersPrismaMock;
  passwords: PasswordsMock;
} {
  const prisma: UsersPrismaMock = {
    user: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    $executeRaw: jest.fn(),
  };
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
      id: testId(1),
      email: 'ash@example.com',
      language: 'pl',
      theme: 'system',
      createdAt,
    });

    const result = await service.createUser({
      email: '  Ash@Example.COM ',
      password: 'pikachu123',
    });

    expect(passwords.hash).toHaveBeenCalledWith('pikachu123');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: 'ash@example.com', passwordHash: 'ARGON2HASH' },
      select: {
        id: true,
        email: true,
        language: true,
        theme: true,
        createdAt: true,
      },
    });
    expect(result).toEqual({
      id: testId(1),
      email: 'ash@example.com',
      language: 'pl',
      theme: 'system',
      createdAt,
    });
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

  describe('findByEmail', () => {
    it('normalizes the email and selects the credential row', async () => {
      const row = {
        id: testId(1),
        email: 'ash@example.com',
        passwordHash: 'ARGON2HASH',
        language: 'pl',
        theme: 'system',
        createdAt: new Date('2026-10-05T12:00:00.000Z'),
      };
      prisma.user.findUnique.mockResolvedValue(row);

      const result = await service.findByEmail('  Ash@Example.COM ');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'ash@example.com' },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          language: true,
          theme: true,
          createdAt: true,
        },
      });
      expect(result).toEqual(row);
    });

    it('returns null for a blank email without querying', async () => {
      await expect(service.findByEmail('   ')).resolves.toBeNull();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('selects only id/email/createdAt (never passwordHash)', async () => {
      const row = {
        id: testId(7),
        email: 'ash@example.com',
        language: 'pl',
        theme: 'system',
        createdAt: new Date('2026-10-05T12:00:00.000Z'),
      };
      prisma.user.findUnique.mockResolvedValue(row);

      const result = await service.findById(testId(7));

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: testId(7) },
        select: {
          id: true,
          email: true,
          language: true,
          theme: true,
          createdAt: true,
        },
      });
      expect(result).toEqual(row);
      expect(result).not.toHaveProperty('passwordHash');
    });
  });

  describe('createFirstUser', () => {
    it('inserts atomically when the users table is empty', async () => {
      const createdAt = new Date('2026-10-05T12:00:00.000Z');
      passwords.hash.mockResolvedValue('ARGON2HASH');
      prisma.user.count.mockResolvedValue(0);
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.user.findUnique.mockResolvedValue({
        id: testId(1),
        email: 'ash@example.com',
        language: 'pl',
        theme: 'system',
        createdAt,
      });

      const result = await service.createFirstUser({
        email: '  Ash@Example.COM ',
        password: 'pikachu123',
      });

      expect(passwords.hash).toHaveBeenCalledWith('pikachu123');
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const [strings, ...values] = prisma.$executeRaw.mock.calls[0] as [
        string[],
        ...unknown[],
      ];
      const sql = strings.join('?');
      expect(sql).toContain('INSERT INTO users (id, email, password_hash)');
      expect(sql).toContain('WHERE NOT EXISTS (SELECT 1 FROM users)');
      expect(values).toHaveLength(3);
      expect(values[0]).toMatch(UUID_V7_PATTERN);
      expect(values.slice(1)).toEqual(['ash@example.com', 'ARGON2HASH']);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'ash@example.com' },
        select: {
          id: true,
          email: true,
          language: true,
          theme: true,
          createdAt: true,
        },
      });
      expect(result).toEqual({
        id: testId(1),
        email: 'ash@example.com',
        language: 'pl',
        theme: 'system',
        createdAt,
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('rejects with 409 without hashing or inserting when a user already exists', async () => {
      prisma.user.count.mockResolvedValue(1);

      await expect(
        service.createFirstUser({
          email: 'ash@example.com',
          password: 'pikachu123',
        }),
      ).rejects.toThrow(new ConflictException(SETUP_COMPLETED_MESSAGE));
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects with 409 when the atomic insert affects no rows', async () => {
      passwords.hash.mockResolvedValue('ARGON2HASH');
      prisma.user.count.mockResolvedValue(0);
      prisma.$executeRaw.mockResolvedValue(0);

      await expect(
        service.createFirstUser({
          email: 'ash@example.com',
          password: 'pikachu123',
        }),
      ).rejects.toThrow(new ConflictException(SETUP_COMPLETED_MESSAGE));
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('retries after a transient insert failure and resolves the created user', async () => {
      const createdAt = new Date('2026-10-05T12:00:00.000Z');
      passwords.hash.mockResolvedValue('ARGON2HASH');
      prisma.user.count.mockResolvedValue(0);
      prisma.$executeRaw
        .mockRejectedValueOnce(new Error('deadlock found'))
        .mockResolvedValueOnce(1);
      prisma.user.findUnique.mockResolvedValue({
        id: testId(1),
        email: 'ash@example.com',
        language: 'pl',
        theme: 'system',
        createdAt,
      });

      const result = await service.createFirstUser({
        email: 'ash@example.com',
        password: 'pikachu123',
      });

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'ash@example.com' },
        select: {
          id: true,
          email: true,
          language: true,
          theme: true,
          createdAt: true,
        },
      });
      expect(result).toEqual({
        id: testId(1),
        email: 'ash@example.com',
        language: 'pl',
        theme: 'system',
        createdAt,
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('retries and returns 409 when the retried insert affects no rows', async () => {
      passwords.hash.mockResolvedValue('ARGON2HASH');
      prisma.user.count.mockResolvedValue(0);
      prisma.$executeRaw
        .mockRejectedValueOnce(new Error('deadlock found'))
        .mockResolvedValueOnce(0);

      await expect(
        service.createFirstUser({
          email: 'ash@example.com',
          password: 'pikachu123',
        }),
      ).rejects.toThrow(new ConflictException(SETUP_COMPLETED_MESSAGE));
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('maps a contended insert failure to 409 without surfacing the raw error', async () => {
      passwords.hash.mockResolvedValue('ARGON2HASH');
      prisma.user.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      prisma.$executeRaw.mockRejectedValue(new Error('deadlock found'));

      let caught: unknown;
      try {
        await service.createFirstUser({
          email: 'ash@example.com',
          password: 'pikachu123',
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as Error).message).toBe(SETUP_COMPLETED_MESSAGE);
      expect((caught as Error).message).not.toContain('deadlock');
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rethrows the original error after attempts are exhausted when no user exists', async () => {
      passwords.hash.mockResolvedValue('ARGON2HASH');
      prisma.user.count.mockResolvedValue(0);
      prisma.$executeRaw.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.createFirstUser({
          email: 'ash@example.com',
          password: 'pikachu123',
        }),
      ).rejects.toThrow('connection lost');
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(MAX_SETUP_ATTEMPTS);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('setPassword', () => {
    it('normalizes the email, hashes, and returns the updated user', async () => {
      const createdAt = new Date('2026-10-05T12:00:00.000Z');
      passwords.hash.mockResolvedValue('ARGON2HASH');
      prisma.user.update.mockResolvedValue({
        id: testId(1),
        email: 'ash@example.com',
        language: 'pl',
        theme: 'system',
        createdAt,
      });

      const result = await service.setPassword({
        email: '  Ash@Example.COM ',
        password: 'pikachu123',
      });

      expect(passwords.hash).toHaveBeenCalledWith('pikachu123');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { email: 'ash@example.com' },
        data: { passwordHash: 'ARGON2HASH' },
        select: {
          id: true,
          email: true,
          language: true,
          theme: true,
          createdAt: true,
        },
      });
      expect(result).toEqual({
        id: testId(1),
        email: 'ash@example.com',
        language: 'pl',
        theme: 'system',
        createdAt,
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('rejects a blank (whitespace-only) email without hashing', async () => {
      await expect(
        service.setPassword({ email: '   ', password: 'pikachu123' }),
      ).rejects.toThrow(new BadRequestException('email must not be blank'));
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an empty password without hashing', async () => {
      await expect(
        service.setPassword({ email: 'ash@example.com', password: '' }),
      ).rejects.toThrow(new BadRequestException('password must not be empty'));
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an email longer than 255 characters', async () => {
      await expect(
        service.setPassword({
          email: `${'a'.repeat(256)}@example.com`,
          password: 'pikachu123',
        }),
      ).rejects.toThrow(
        new BadRequestException('email must be at most 255 characters'),
      );
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a password longer than 1024 characters', async () => {
      await expect(
        service.setPassword({
          email: 'ash@example.com',
          password: 'x'.repeat(1025),
        }),
      ).rejects.toThrow(
        new BadRequestException('password must be at most 1024 characters'),
      );
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('maps P2025 (missing row) to 404', async () => {
      passwords.hash.mockResolvedValue('ARGON2HASH');
      prisma.user.update.mockRejectedValue(knownError('P2025'));

      await expect(
        service.setPassword({
          email: 'ash@example.com',
          password: 'pikachu123',
        }),
      ).rejects.toThrow(
        new NotFoundException('No user with email "ash@example.com" was found'),
      );
    });
  });

  describe('hasAnyUser', () => {
    it('is false when the users table is empty', async () => {
      prisma.user.count.mockResolvedValue(0);
      await expect(service.hasAnyUser()).resolves.toBe(false);
    });

    it('is true when at least one user exists', async () => {
      prisma.user.count.mockResolvedValue(3);
      await expect(service.hasAnyUser()).resolves.toBe(true);
    });
  });
});
