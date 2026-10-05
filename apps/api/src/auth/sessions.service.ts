import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';

export interface CreateSessionResult {
  /** Raw cookie token — only ever returned to the caller, never stored. */
  token: string;
  expiresAt: Date;
}

export interface ValidatedSession {
  userId: number;
  expiresAt: Date;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async create(
    userId: number,
    options: { userAgent?: string | null; now?: Date } = {},
  ): Promise<CreateSessionResult> {
    const now = options.now ?? new Date();
    const token = randomBytes(32).toString('base64url'); // 43 chars
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlMs);
    await this.prisma.session.create({
      data: {
        id: this.digest(token),
        userId,
        expiresAt,
        userAgent: options.userAgent ?? null,
      },
    });
    return { token, expiresAt };
  }

  /** Loads + slides. Returns null (and drops the row) when missing/expired. */
  async validate(
    token: string,
    now: Date = new Date(),
  ): Promise<ValidatedSession | null> {
    const id = this.digest(token);
    const row = await this.prisma.session.findUnique({ where: { id } });
    if (!row) {
      return null;
    }
    if (row.expiresAt.getTime() <= now.getTime()) {
      await this.prisma.session.deleteMany({ where: { id } });
      return null;
    }
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlMs);
    await this.prisma.session.update({ where: { id }, data: { expiresAt } });
    return { userId: row.userId, expiresAt };
  }

  /** Idempotent: deleting a missing/unknown token is a no-op. */
  async revoke(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: this.digest(token) } });
  }

  async cleanupExpired(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return count;
  }

  private digest(token: string): string {
    return createHmac('sha256', this.config.sessionSecret)
      .update(token)
      .digest('hex');
  }
}
