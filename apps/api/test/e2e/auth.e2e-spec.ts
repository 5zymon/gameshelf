import * as argon2 from 'argon2';
import { createHmac } from 'node:crypto';
import { SessionCleanupService } from '../../src/auth/session-cleanup.service';
import { SessionsService } from '../../src/auth/sessions.service';
import { UsersService } from '../../src/auth/users.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';
import { seedUser } from '../helpers/seed';

const TTL_MINUTES = 120;
const TTL_MS = TTL_MINUTES * 60_000;

function digest(token: string): string {
  const secret = process.env.SESSION_SECRET;
  if (secret === undefined) {
    throw new Error('SESSION_SECRET is not set for the test run');
  }
  return createHmac('sha256', secret).update(token).digest('hex');
}

async function findSession(
  prisma: PrismaService,
  token: string,
): Promise<{
  expiresAt: Date;
  userId: string;
  userAgent: string | null;
} | null> {
  return prisma.session.findUnique({
    where: { id: digest(token) },
    select: { expiresAt: true, userId: true, userAgent: true },
  });
}

describe('Auth foundation (e2e)', () => {
  let test: TestApp;
  let users: UsersService;
  let sessions: SessionsService;
  let cleanup: SessionCleanupService;

  beforeAll(async () => {
    test = await createTestApp();
    users = test.app.get(UsersService);
    sessions = test.app.get(SessionsService);
    cleanup = test.app.get(SessionCleanupService);
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
  });

  afterAll(async () => {
    await test.app.close();
  });

  it('AC1: stores an Argon2id hash for a created user', async () => {
    const created = await users.createUser({
      email: 'Ash@Example.com',
      password: 'pikachu123',
    });

    expect(created.email).toBe('ash@example.com');
    expect(created).not.toHaveProperty('passwordHash');

    const row = await test.prisma.user.findUnique({
      where: { email: 'ash@example.com' },
    });
    expect(row).not.toBeNull();
    if (!row) {
      throw new Error('user row missing');
    }
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toBe('pikachu123');
    await expect(argon2.verify(row.passwordHash, 'pikachu123')).resolves.toBe(
      true,
    );
    await expect(argon2.verify(row.passwordHash, 'wrong')).resolves.toBe(false);
  });

  it('AC2: the sessions.id primary key is indexed', async () => {
    const rows = await test.prisma.$queryRaw<{ INDEX_NAME: string }[]>`
      SELECT INDEX_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'sessions'
        AND COLUMN_NAME = 'id'
    `;

    expect(rows.map((r) => r.INDEX_NAME)).toContain('PRIMARY');
  });

  it('AC2/AC6: stores only the HMAC digest of the cookie token', async () => {
    const user = await seedUser(test.prisma, { email: 'ash@example.com' });

    const { token } = await sessions.create(user.id, { userAgent: 'jest' });

    expect(
      await test.prisma.session.findUnique({ where: { id: token } }),
    ).toBeNull();

    const row = await findSession(test.prisma, token);
    expect(row).not.toBeNull();
    if (!row) {
      throw new Error('session row missing');
    }
    expect(row.userId).toBe(user.id);
    expect(row.userAgent).toBe('jest');
    expect(digest(token)).toBe(
      createHmac('sha256', process.env.SESSION_SECRET ?? '')
        .update(token)
        .digest('hex'),
    );
  });

  it('AC4: expiry is finite and slides forward on activity', async () => {
    const user = await seedUser(test.prisma, { email: 'ash@example.com' });

    const before = Date.now();
    const { token, expiresAt } = await sessions.create(user.id);

    expect(Number.isFinite(expiresAt.getTime())).toBe(true);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + TTL_MS);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + TTL_MS + 5_000,
    );

    const first = await findSession(test.prisma, token);
    expect(first).not.toBeNull();
    if (!first) {
      throw new Error('session row missing');
    }

    const later = new Date(Date.now() + 1_000);
    const validated = await sessions.validate(token, later);
    expect(validated).toEqual({
      userId: user.id,
      expiresAt: new Date(later.getTime() + TTL_MS),
    });

    const second = await findSession(test.prisma, token);
    expect(second).not.toBeNull();
    if (!second) {
      throw new Error('session row missing after sweep');
    }
    expect(second.expiresAt.getTime()).toBeGreaterThan(
      first.expiresAt.getTime(),
    );
  });

  it('AC3: periodic cleanup removes expired rows', async () => {
    const user = await seedUser(test.prisma, { email: 'ash@example.com' });
    const { token } = await sessions.create(user.id);

    await test.prisma.session.update({
      where: { id: digest(token) },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await cleanup.cleanup();

    expect(
      await test.prisma.session.findUnique({ where: { id: digest(token) } }),
    ).toBeNull();
  });

  it('rejects an expired token and drops its row', async () => {
    const user = await seedUser(test.prisma, { email: 'ash@example.com' });
    const { token } = await sessions.create(user.id);

    await test.prisma.session.update({
      where: { id: digest(token) },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(sessions.validate(token)).resolves.toBeNull();
    expect(
      await test.prisma.session.findUnique({ where: { id: digest(token) } }),
    ).toBeNull();
  });
});
