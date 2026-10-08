import { Injectable, UnauthorizedException } from '@nestjs/common';
import { toLanguage, type Language } from '../i18n/language';
import { toTheme, type Theme } from '../settings/theme';
import type { CreatedUser } from './users.service';
import { PasswordService } from './password.service';
import { SessionsService } from './sessions.service';
import { UsersService } from './users.service';

/**
 * A real Argon2id hash (repo defaults: m=65536, p=4, t=3) verified against
 * every login for an unknown email. Equalizing the work makes the response
 * time indistinguishable from a wrong-password attempt.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$tgmIkAm9J8NWuBo9OBqEyQ$GgEUk/XkMBYkRRbkWc6s1576VUGsTUsKsZFJKu8tx7w';

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

export interface LoginResult {
  user: {
    id: number;
    email: string;
    language: Language;
    theme: Theme;
    createdAt: Date;
  };
  token: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
  ) {}

  async login(
    email: string,
    password: string,
    userAgent?: string | null,
  ): Promise<LoginResult> {
    const user = await this.users.findByEmail(email);
    const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const ok = await this.passwords.verify(hash, password);
    if (user === null || !ok) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const { token, expiresAt } = await this.sessions.create(user.id, {
      userAgent,
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        // Coerce a corrupt/legacy row to the default so an invalid value can
        // never reach the NEXT_LOCALE cookie or the response.
        language: toLanguage(user.language),
        // Same coercion for the theme (NEXT_THEME cookie / response).
        theme: toTheme(user.theme),
        createdAt: user.createdAt,
      },
      token,
      expiresAt,
    };
  }

  async me(userId: number): Promise<CreatedUser> {
    const user = await this.users.findById(userId);
    if (user === null) {
      throw new UnauthorizedException('Authentication required');
    }
    // Same coercion as login: the response body carries the language and theme.
    return {
      ...user,
      language: toLanguage(user.language),
      theme: toTheme(user.theme),
    };
  }

  async logout(token: string): Promise<void> {
    await this.sessions.revoke(token);
  }
}
