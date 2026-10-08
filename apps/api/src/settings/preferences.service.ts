import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toLanguage, type Language } from '../i18n/language';
import { toTheme, type Theme } from './theme';
import { PreferencesModel } from './dto/preferences.model';

/**
 * Reads and writes the authenticated user's preferences: the UI language
 * (`users.language`) and the UI theme (`users.theme`). The service is
 * per-user so the controller stays a thin adapter over the session.
 *
 * Both methods are defensive about a missing user: the `SessionGuard` already
 * proved the account exists, so a `P2025` here only means it vanished
 * mid-request. We surface that as a 404 rather than a 500.
 */
@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: number): Promise<PreferencesModel> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { language: true, theme: true },
    });
    if (user === null) {
      throw new NotFoundException('Authentication required');
    }
    return { language: toLanguage(user.language), theme: toTheme(user.theme) };
  }

  async update(
    userId: number,
    language: Language,
    theme: Theme,
  ): Promise<PreferencesModel> {
    try {
      const { language: storedLanguage, theme: storedTheme } =
        await this.prisma.user.update({
          where: { id: userId },
          data: { language, theme },
          select: { language: true, theme: true },
        });
      return {
        language: toLanguage(storedLanguage),
        theme: toTheme(storedTheme),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Authentication required');
      }
      throw error;
    }
  }
}
