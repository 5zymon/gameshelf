import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toLanguage, type Language } from '../i18n/language';
import { PreferencesModel } from './dto/preferences.model';

/**
 * Reads and writes the authenticated user's preferences. The only preference
 * today is the UI language (`users.language`); the service is per-user so the
 * controller stays a thin adapter over the session.
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
      select: { language: true },
    });
    if (user === null) {
      throw new NotFoundException('Authentication required');
    }
    return { language: toLanguage(user.language) };
  }

  async update(userId: number, language: Language): Promise<PreferencesModel> {
    try {
      const { language: stored } = await this.prisma.user.update({
        where: { id: userId },
        data: { language },
        select: { language: true },
      });
      return { language: toLanguage(stored) };
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
