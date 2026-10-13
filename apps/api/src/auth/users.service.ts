import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { uuidv7 } from '../common/uuid-v7';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH } from './credentials';
import { PasswordService } from './password.service';

/** Returned by POST /setup once an account already exists (HTTP 409). */
export const SETUP_COMPLETED_MESSAGE = 'Setup has already been completed';

/**
 * How many times the first-run insert is attempted before giving up. A losing
 * racer normally resolves on the first retry once the winner has committed; the
 * extra attempts cover the short window where the winner's row is not yet
 * visible to the loser's connection.
 */
export const MAX_SETUP_ATTEMPTS = 3;

export interface CreateUserInput {
  email: string;
  password: string;
}

/** CLI (`user:passwd`) and any future password-reset path. */
export interface SetPasswordInput {
  email: string;
  password: string;
}

export interface CreatedUser {
  id: string;
  email: string;
  language: string;
  theme: string;
  createdAt: Date;
}

/** Full credential row used during login — never leaves the service. */
export interface UserCredentials {
  id: string;
  email: string;
  passwordHash: string;
  language: string;
  theme: string;
  createdAt: Date;
}

/** Validated, normalized, hashed input — the shared half of every creation path. */
interface PreparedUser {
  email: string;
  passwordHash: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  /** CLI (`user:create`) and every normal creation path. */
  async createUser(input: CreateUserInput): Promise<CreatedUser> {
    const { email, passwordHash } = await this.prepareUser(input);
    try {
      return await this.prisma.user.create({
        data: { email, passwordHash },
        select: {
          id: true,
          email: true,
          language: true,
          theme: true,
          createdAt: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `A user with email "${email}" already exists`,
        );
      }
      throw error;
    }
  }

  /** CLI (`user:passwd`): replaces the stored hash for an existing account. */
  async setPassword(input: SetPasswordInput): Promise<CreatedUser> {
    const { email, passwordHash } = await this.prepareUser(input);
    try {
      return await this.prisma.user.update({
        where: { email },
        data: { passwordHash },
        select: {
          id: true,
          email: true,
          language: true,
          theme: true,
          createdAt: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`No user with email "${email}" was found`);
      }
      throw error;
    }
  }

  /**
   * First-run only: inserts the account iff `users` is empty. The insert is a
   * single atomic statement, so two concurrent callers can never both win —
   * the loser's `NOT EXISTS` predicate is false and it affects zero rows.
   *
   * Under InnoDB contention the losing caller can be rolled back before the
   * winner's row becomes visible to it. Because that window is only a few
   * milliseconds, the insert is retried a bounded number of times: a failed
   * attempt is followed by a `hasAnyUser()` check, and a retried statement
   * against the now-committed winner affects zero rows. Both cases surface the
   * same `ConflictException` (409) as any other closed-setup request. A genuine
   * error with no user ever created is rethrown after the attempts are
   * exhausted — never masked as a conflict.
   *
   * Shares `prepareUser` with `createUser`, so hashing/validation cannot
   * diverge. The raw SQL mirrors the `User` model in `prisma/schema.prisma`
   * (`@@map("users")`, `password_hash`). `id` is supplied here because Prisma's
   * `uuid(7)` default does not apply to raw SQL (ADR-006).
   */
  async createFirstUser(input: CreateUserInput): Promise<CreatedUser> {
    // Cheap fast path: closed setup must not pay for Argon2 or leak timing.
    if (await this.hasAnyUser()) {
      throw new ConflictException(SETUP_COMPLETED_MESSAGE);
    }
    const { email, passwordHash } = await this.prepareUser(input);

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_SETUP_ATTEMPTS; attempt++) {
      try {
        const id = uuidv7();
        const affected = await this.prisma.$executeRaw`
          INSERT INTO users (id, email, password_hash)
          SELECT ${id}, ${email}, ${passwordHash} FROM DUAL
          WHERE NOT EXISTS (SELECT 1 FROM users)`;
        if (affected === 0) {
          // The emptiness guard held: another caller won the race.
          throw new ConflictException(SETUP_COMPLETED_MESSAGE);
        }
        const created = await this.prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            language: true,
            theme: true,
            createdAt: true,
          },
        });
        if (created === null) {
          throw new ConflictException(SETUP_COMPLETED_MESSAGE); // defensive
        }
        return created;
      } catch (error) {
        // A conflict we raised ourselves is final — do not retry it.
        if (error instanceof ConflictException) {
          throw error;
        }
        lastError = error;
        // The winner's row may already be committed; if so this is a conflict
        // (409), not an internal error.
        if (await this.hasAnyUser()) {
          throw new ConflictException(SETUP_COMPLETED_MESSAGE);
        }
      }
    }

    // Attempts exhausted: if a winner appeared in the meantime this is still a
    // conflict; otherwise surface the real failure rather than masking it.
    if (await this.hasAnyUser()) {
      throw new ConflictException(SETUP_COMPLETED_MESSAGE);
    }
    throw lastError;
  }

  /** True iff the `users` table has at least one row (setup is closed). */
  async hasAnyUser(): Promise<boolean> {
    return (await this.prisma.user.count()) > 0;
  }

  async findByEmail(email: string): Promise<UserCredentials | null> {
    const normalized = email.trim().toLowerCase();
    if (normalized === '') {
      return null;
    }
    return this.prisma.user.findUnique({
      where: { email: normalized },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        language: true,
        theme: true,
        createdAt: true,
      },
    });
  }

  async findById(id: string): Promise<CreatedUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        language: true,
        theme: true,
        createdAt: true,
      },
    });
  }

  /** Single source of truth for length/trim/lowercase, blank checks, hashing. */
  private async prepareUser(input: CreateUserInput): Promise<PreparedUser> {
    if (input.email.length > EMAIL_MAX_LENGTH) {
      throw new BadRequestException(
        `email must be at most ${String(EMAIL_MAX_LENGTH)} characters`,
      );
    }
    if (input.password.length > PASSWORD_MAX_LENGTH) {
      throw new BadRequestException(
        `password must be at most ${String(PASSWORD_MAX_LENGTH)} characters`,
      );
    }
    const email = input.email.trim().toLowerCase();
    if (email === '') {
      throw new BadRequestException('email must not be blank');
    }
    if (input.password.length === 0) {
      throw new BadRequestException('password must not be empty');
    }
    const passwordHash = await this.passwords.hash(input.password);
    return { email, passwordHash };
  }
}
