import { createHmac } from 'node:crypto';
import { AUTH_CONFIG, type AuthConfig } from '../../src/auth/auth.config';
import { SessionsService } from '../../src/auth/sessions.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

interface SessionRow {
  id: string;
  userId: number;
  expiresAt: Date;
  createdAt: Date;
  userAgent: string | null;
}

interface SessionsPrismaMock {
  session: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
}

const SECRET = 'a'.repeat(40);
const TTL_MS = 60_000;

function digest(token: string): string {
  return createHmac('sha256', SECRET).update(token).digest('hex');
}

function createService(): {
  service: SessionsService;
  mock: SessionsPrismaMock;
} {
  const mock: SessionsPrismaMock = {
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const config: AuthConfig = {
    sessionSecret: SECRET,
    sessionTtlMs: TTL_MS,
    cookieSecure: false,
  };
  return {
    service: new SessionsService(mock as unknown as PrismaService, config),
    mock,
  };
}

describe('SessionsService (unit)', () => {
  let service: SessionsService;
  let mock: SessionsPrismaMock;

  beforeEach(() => {
    ({ service, mock } = createService());
  });

  describe('create', () => {
    it('returns a 43-char token and stores only its HMAC digest', async () => {
      const now = new Date('2026-10-05T12:00:00.000Z');
      mock.session.create.mockResolvedValue({});

      const result = await service.create(7, { userAgent: 'jest', now });

      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(result.expiresAt.getTime()).toBe(now.getTime() + TTL_MS);
      expect(mock.session.create).toHaveBeenCalledWith({
        data: {
          id: digest(result.token),
          userId: 7,
          expiresAt: result.expiresAt,
          userAgent: 'jest',
        },
      });
    });

    it('stores a null userAgent when none is given', async () => {
      const now = new Date('2026-10-05T12:00:00.000Z');
      mock.session.create.mockResolvedValue({});

      await service.create(7, { now });

      expect(mock.session.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String) as string,
          userId: 7,
          expiresAt: expect.any(Date) as Date,
          userAgent: null,
        },
      });
    });
  });

  describe('validate', () => {
    it('returns null for an unknown token without touching the row', async () => {
      mock.session.findUnique.mockResolvedValue(null);

      const result = await service.validate('unknown');

      expect(result).toBeNull();
      expect(mock.session.update).not.toHaveBeenCalled();
      expect(mock.session.deleteMany).not.toHaveBeenCalled();
    });

    it('drops an expired row and returns null', async () => {
      const now = new Date('2026-10-05T12:00:00.000Z');
      const token = 'token';
      const row: SessionRow = {
        id: digest(token),
        userId: 7,
        expiresAt: new Date(now.getTime() - 1),
        createdAt: now,
        userAgent: null,
      };
      mock.session.findUnique.mockResolvedValue(row);

      const result = await service.validate(token, now);

      expect(result).toBeNull();
      expect(mock.session.update).not.toHaveBeenCalled();
      expect(mock.session.deleteMany).toHaveBeenCalledWith({
        where: { id: digest(token) },
      });
    });

    it('slides expiresAt forward on activity', async () => {
      const created = new Date('2026-10-05T12:00:00.000Z');
      const now = new Date(created.getTime() + 1_000);
      const token = 'token';
      const row: SessionRow = {
        id: digest(token),
        userId: 7,
        expiresAt: new Date(created.getTime() + TTL_MS),
        createdAt: created,
        userAgent: null,
      };
      mock.session.findUnique.mockResolvedValue(row);
      mock.session.update.mockResolvedValue({});

      const result = await service.validate(token, now);

      const slid = new Date(now.getTime() + TTL_MS);
      expect(result).toEqual({ userId: 7, expiresAt: slid });
      expect(mock.session.update).toHaveBeenCalledWith({
        where: { id: digest(token) },
        data: { expiresAt: slid },
      });
    });
  });

  describe('revoke', () => {
    it('deletes by digest (idempotent)', async () => {
      mock.session.deleteMany.mockResolvedValue({ count: 0 });

      await service.revoke('token');

      expect(mock.session.deleteMany).toHaveBeenCalledWith({
        where: { id: digest('token') },
      });
    });
  });

  describe('cleanupExpired', () => {
    it('deletes rows expired before now and returns the count', async () => {
      const now = new Date('2026-10-05T12:00:00.000Z');
      mock.session.deleteMany.mockResolvedValue({ count: 3 });

      const removed = await service.cleanupExpired(now);

      expect(removed).toBe(3);
      expect(mock.session.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lte: now } },
      });
    });
  });

  it('exposes the auth config token', () => {
    expect(typeof AUTH_CONFIG).toBe('symbol');
  });
});
