import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlatformDto } from './dto/create-platform.dto';
import { PlatformModel } from './dto/platform-response.model';
import { UpdatePlatformDto } from './dto/update-platform.dto';

@Injectable()
export class PlatformsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * All platforms with a game count each, sorted by name (ci collation).
   * Exactly two queries for any number of platforms — the count map comes
   * from one groupBy aggregate, never one count per platform (no N+1).
   */
  async list(): Promise<PlatformModel[]> {
    const [platforms, groups] = await Promise.all([
      this.prisma.platform.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.game.groupBy({ by: ['platformId'], _count: { _all: true } }),
    ]);
    const countByPlatformId = new Map<number, number>(
      groups.map((g) => [g.platformId, g._count._all]),
    );
    return platforms.map((p) => ({
      ...p,
      gameCount: countByPlatformId.get(p.id) ?? 0,
    }));
  }

  async findOne(id: number): Promise<PlatformModel> {
    const [platform, gameCount] = await Promise.all([
      this.prisma.platform.findUnique({ where: { id } }),
      this.prisma.game.count({ where: { platformId: id } }),
    ]);
    if (!platform) {
      throw new NotFoundException(`Platform with id ${String(id)} not found`);
    }
    return { ...platform, gameCount };
  }

  async create(dto: CreatePlatformDto): Promise<PlatformModel> {
    const name = dto.name.trim();
    if (name === '') {
      throw new BadRequestException('name must not be blank');
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const slug = await this.reserveSlug(name);
      try {
        const platform = await this.prisma.platform.create({
          data: { name, slug },
        });
        return { ...platform, gameCount: 0 };
      } catch (error) {
        const target = this.uniqueViolationTarget(error);
        if (target === 'name') {
          throw new ConflictException(
            `A platform named "${name}" already exists`,
          );
        }
        if (target !== 'slug') {
          throw error;
        }
        // A concurrent create took the slug — reserve a fresh one and retry.
        lastError = error;
      }
    }
    throw lastError; // persistent slug race → 500
  }

  async rename(id: number, dto: UpdatePlatformDto): Promise<PlatformModel> {
    const name = dto.name.trim();
    if (name === '') {
      throw new BadRequestException('name must not be blank');
    }
    const existing = await this.prisma.platform.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!existing) {
      throw new NotFoundException(`Platform with id ${String(id)} not found`);
    }
    try {
      const platform = await this.prisma.platform.update({
        where: { id },
        data: {
          ...(existing.name !== name && { name }),
          ...(dto.abbreviation !== undefined && {
            abbreviation: dto.abbreviation,
          }),
          ...(dto.alternativeName !== undefined && {
            alternativeName: dto.alternativeName,
          }),
          ...(dto.igdbId !== undefined && { igdbId: dto.igdbId }),
        },
      });
      const gameCount = await this.prisma.game.count({
        where: { platformId: id },
      });
      return { ...platform, gameCount };
    } catch (error) {
      if (this.uniqueViolationTarget(error) === 'name') {
        throw new ConflictException(
          `A platform named "${name}" already exists`,
        );
      }
      if (this.isRecordNotFound(error)) {
        throw new NotFoundException(`Platform with id ${String(id)} not found`);
      }
      throw error;
    }
  }

  /**
   * Delete — blocked while games reference the platform (409, non-destructive;
   * spec §4.6.5). The FK `ON DELETE RESTRICT` is the backstop for the race
   * where a game appears between the count and the delete.
   */
  async remove(id: number): Promise<void> {
    const existing = await this.prisma.platform.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Platform with id ${String(id)} not found`);
    }
    const gameCount = await this.prisma.game.count({
      where: { platformId: id },
    });
    if (gameCount > 0) {
      throw new ConflictException(
        `Platform with id ${String(id)} has ${String(gameCount)} game(s); reassign or delete them before deleting the platform`,
      );
    }
    try {
      await this.prisma.platform.delete({ where: { id } });
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new ConflictException(
          `Platform with id ${String(id)} has games; reassign or delete them before deleting the platform`,
        );
      }
      if (this.isRecordNotFound(error)) {
        throw new NotFoundException(`Platform with id ${String(id)} not found`);
      }
      throw error;
    }
  }

  /**
   * First free slug for a name: slugified name, then `-2`, `-3`, … on
   * collision. Slugs are never rewritten afterwards (seed and rename leave
   * them alone), so a stable slug survives renames.
   */
  private async reserveSlug(name: string): Promise<string> {
    const base = this.slugify(name) || 'platform';
    let candidate = base;
    for (let suffix = 2; ; suffix += 1) {
      const taken = await this.prisma.platform.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) {
        return candidate;
      }
      candidate = `${base}-${String(suffix)}`;
    }
  }

  private slugify(name: string): string {
    return name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * 'name' | 'slug' | null — which unique key a P2002 hit, if any.
   *
   * Prisma 7 + driver adapter does not populate `meta.target`; the violated
   * constraint arrives via `meta.driverAdapterError.cause.constraint.index`
   * (e.g. `platforms_name_key`). Both shapes are handled.
   */
  private uniqueViolationTarget(error: unknown): 'name' | 'slug' | null {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return null;
    }
    const target = error.meta?.target;
    const fields = Array.isArray(target)
      ? target.filter((f): f is string => typeof f === 'string')
      : typeof target === 'string'
        ? [target]
        : [];
    if (fields.includes('name')) {
      return 'name';
    }
    if (fields.includes('slug')) {
      return 'slug';
    }
    const dae = error.meta?.driverAdapterError as
      { cause?: { constraint?: { index?: unknown } } } | undefined;
    const index = dae?.cause?.constraint?.index;
    if (typeof index === 'string') {
      if (index.endsWith('_name_key')) {
        return 'name';
      }
      if (index.endsWith('_slug_key')) {
        return 'slug';
      }
    }
    return null;
  }

  private isRecordNotFound(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    );
  }
}
