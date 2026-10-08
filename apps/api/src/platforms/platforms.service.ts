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
import {
  normalizePlatformName,
  type PlatformMatchCandidate,
} from './platform-match';

/** Canonical fields the platform sync writes (ticket 4.2). */
export interface CanonicalPlatformInput {
  name: string;
  abbreviation: string | null;
  alternativeName: string | null;
  platformFamily: number | null;
  igdbId: number;
}

@Injectable()
export class PlatformsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * All platforms with a game count each. Import-created rows (awaiting
   * review) lead, then name (ci collation). Exactly two queries for any
   * number of platforms — the count map comes from one groupBy aggregate,
   * never one count per platform (no N+1).
   */
  async list(): Promise<PlatformModel[]> {
    const [platforms, groups] = await Promise.all([
      this.prisma.platform.findMany({
        orderBy: [{ addedByImport: 'desc' }, { name: 'asc' }],
      }),
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

  /**
   * Every platform as a matcher candidate, oldest id first (ticket 4.2). One
   * query; the sync service builds its index from this single read. Aliases
   * (old names, merged-away names) are folded in as extra match keys.
   */
  async listMatchCandidates(): Promise<PlatformMatchCandidate[]> {
    const rows = await this.prisma.platform.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        abbreviation: true,
        alternativeName: true,
        aliases: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      abbreviation: row.abbreviation,
      alternativeName: row.alternativeName,
      aliases: row.aliases.map((alias) => alias.name),
    }));
  }

  /**
   * Creates a canonical platform for the sync path: reserves a slug from the
   * name (never rewriting existing slugs) and stores the IGDB link. Unlike the
   * public `create`, this is not for arbitrary user input and does not map
   * unique violations to HTTP errors.
   */
  async createCanonical(
    input: CanonicalPlatformInput,
  ): Promise<PlatformMatchCandidate> {
    const slug = await this.reserveSlug(input.name);
    return this.prisma.platform.create({
      data: {
        name: input.name,
        slug,
        abbreviation: input.abbreviation,
        alternativeName: input.alternativeName,
        platformFamily: input.platformFamily,
        igdbId: input.igdbId,
      },
      select: {
        id: true,
        name: true,
        abbreviation: true,
        alternativeName: true,
      },
    });
  }

  /**
   * Refreshes the canonical fields of an existing platform. Returns `true`
   * only when a write happened (some field changed or a hidden reference row
   * was restored), `false` when the row is missing or already up to date and
   * visible. Never touches `name` or `slug`.
   */
  async updateCanonical(
    id: number,
    input: CanonicalPlatformInput,
  ): Promise<boolean> {
    const existing = await this.prisma.platform.findUnique({
      where: { id },
      select: {
        abbreviation: true,
        alternativeName: true,
        platformFamily: true,
        igdbId: true,
        hidden: true,
      },
    });
    if (!existing) {
      return false;
    }
    const fieldsMatch =
      existing.abbreviation === input.abbreviation &&
      existing.alternativeName === input.alternativeName &&
      existing.platformFamily === input.platformFamily &&
      existing.igdbId === input.igdbId;
    const needsUnhide = existing.hidden;
    if (fieldsMatch && !needsUnhide) {
      return false;
    }
    await this.prisma.platform.update({
      where: { id },
      data: {
        abbreviation: input.abbreviation,
        alternativeName: input.alternativeName,
        platformFamily: input.platformFamily,
        igdbId: input.igdbId,
        ...(needsUnhide && { hidden: false }),
      },
    });
    return true;
  }

  async create(dto: CreatePlatformDto): Promise<PlatformModel> {
    const name = dto.name.trim();
    if (name === '') {
      throw new BadRequestException('name must not be blank');
    }
    await this.assertNameNotAnAlias(name);
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

  /**
   * Creates a platform for an unknown name encountered during import
   * (spec §4.2.3/§4.6.6). The new row is flagged `addedByImport` and awaits
   * confirmation or a merge.
   *
   * Before creating, the normalized name is matched against the alias table:
   * a name that is an alias of an existing platform resolves to that owner
   * instead of creating a duplicate. The same is true of `platforms.name`:
   * if a concurrent insert took the name, the existing row's id is returned.
   * Returns the platform id.
   */
  async createFromImport(rawName: string): Promise<number> {
    const name = rawName.trim();
    if (name === '') {
      throw new BadRequestException('name must not be blank');
    }
    const normalized = normalizePlatformName(name);
    if (normalized === '') {
      throw new BadRequestException('name must not be blank');
    }
    const aliasOwner = await this.prisma.platformAlias.findUnique({
      where: { normalizedName: normalized },
      select: { platformId: true },
    });
    if (aliasOwner) {
      return aliasOwner.platformId;
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const slug = await this.reserveSlug(name);
      try {
        const platform = await this.prisma.platform.create({
          data: { name, slug, addedByImport: true },
          select: { id: true },
        });
        return platform.id;
      } catch (error) {
        const target = this.uniqueViolationTarget(error);
        if (target === 'name') {
          // Lost a race for the name — the winner is the row we want.
          const existing = await this.prisma.platform.findFirst({
            where: { name },
            select: { id: true },
          });
          if (existing) {
            return existing.id;
          }
          throw error;
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

  /**
   * Rename / canonical-field update. Renaming changes only the displayed
   * `name`; the previous name is written as an alias (in the same
   * transaction) so matching against the old name keeps working (spec §4.6.4).
   */
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
    await this.assertNameNotAnAlias(name, id);
    const normalizedOld = normalizePlatformName(existing.name);
    const renameNeeded = existing.name !== name;
    try {
      const platform = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.platform.update({
          where: { id },
          data: {
            ...(renameNeeded && { name }),
            ...(dto.abbreviation !== undefined && {
              abbreviation: dto.abbreviation,
            }),
            ...(dto.alternativeName !== undefined && {
              alternativeName: dto.alternativeName,
            }),
            ...(dto.igdbId !== undefined && { igdbId: dto.igdbId }),
            ...(dto.hidden !== undefined && { hidden: dto.hidden }),
          },
        });
        if (renameNeeded && normalizedOld !== '') {
          await tx.platformAlias.createMany({
            data: [
              {
                platformId: id,
                name: existing.name,
                normalizedName: normalizedOld,
              },
            ],
            skipDuplicates: true,
          });
        }
        return updated;
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
   * Clears the `addedByImport` flag: the user reviewed an import-created
   * platform and keeps it as is (spec §4.6.6).
   */
  async confirm(id: number): Promise<PlatformModel> {
    const platform = await this.prisma.platform
      .update({ where: { id }, data: { addedByImport: false } })
      .catch((error: unknown) => {
        if (this.isRecordNotFound(error)) {
          throw new NotFoundException(
            `Platform with id ${String(id)} not found`,
          );
        }
        throw error;
      });
    const gameCount = await this.prisma.game.count({
      where: { platformId: id },
    });
    return { ...platform, gameCount };
  }

  /**
   * Merges `sourceId` into `targetId` (spec §4.6.4): every game moves to the
   * target, the source's aliases follow, and the source's name/abbreviation/
   * alternative name are added as aliases of the target so a later import
   * reading the merged-away name still resolves to the target. The source row
   * is deleted. Returns the target with a fresh game count.
   */
  async merge(sourceId: number, targetId: number): Promise<PlatformModel> {
    if (sourceId === targetId) {
      throw new BadRequestException('Cannot merge a platform into itself');
    }
    const [source, target] = await Promise.all([
      this.prisma.platform.findUnique({
        where: { id: sourceId },
        select: {
          id: true,
          name: true,
          abbreviation: true,
          alternativeName: true,
        },
      }),
      this.prisma.platform.findUnique({
        where: { id: targetId },
        select: { id: true },
      }),
    ]);
    if (!source) {
      throw new NotFoundException(
        `Platform with id ${String(sourceId)} not found`,
      );
    }
    if (!target) {
      throw new NotFoundException(
        `Platform with id ${String(targetId)} not found`,
      );
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.game.updateMany({
          where: { platformId: sourceId },
          data: { platformId: targetId },
        });
        // Aliases unique by normalized name, so the source's keys can never
        // collide with the target's existing ones.
        await tx.platformAlias.updateMany({
          where: { platformId: sourceId },
          data: { platformId: targetId },
        });
        const aliases = [
          source.name,
          source.abbreviation,
          source.alternativeName,
        ]
          .filter((value): value is string => value !== null)
          .map((value) => ({
            platformId: targetId,
            name: value,
            normalizedName: normalizePlatformName(value),
          }))
          .filter((alias) => alias.normalizedName !== '');
        if (aliases.length > 0) {
          await tx.platformAlias.createMany({
            data: aliases,
            skipDuplicates: true,
          });
        }
        await tx.platform.delete({ where: { id: sourceId } });
      });
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new ConflictException(
          `Platform with id ${String(sourceId)} has games that could not be moved`,
        );
      }
      if (this.isRecordNotFound(error)) {
        throw new NotFoundException(
          `Platform with id ${String(sourceId)} not found`,
        );
      }
      throw error;
    }
    return this.findOne(targetId);
  }

  /**
   * Delete — blocked while games reference the platform (409, non-destructive;
   * spec §4.6.5). A reference platform (`igdbId != null`) without games is
   * never deleted: it is hidden instead, because a refresh would bring it
   * back. A custom/import-created platform is deleted. The FK
   * `ON DELETE RESTRICT` is the backstop for the race where a game appears
   * between the count and the delete.
   */
  async remove(id: number): Promise<void> {
    const existing = await this.prisma.platform.findUnique({
      where: { id },
      select: { id: true, igdbId: true },
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
    if (existing.igdbId !== null) {
      // Reference platform: hide, never delete.
      await this.prisma.platform.update({
        where: { id },
        data: { hidden: true },
      });
      return;
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
   * Rejects a name whose normalized form is already an alias of a different
   * platform (409). `ownerId` is the platform allowed to own that alias (the
   * one being renamed); for a brand-new platform no owner is allowed.
   */
  private async assertNameNotAnAlias(
    name: string,
    ownerId?: number,
  ): Promise<void> {
    const normalized = normalizePlatformName(name);
    if (normalized === '') {
      return;
    }
    const owner = await this.prisma.platformAlias.findUnique({
      where: { normalizedName: normalized },
      select: { platformId: true },
    });
    if (owner && owner.platformId !== ownerId) {
      throw new ConflictException(
        `The name "${name}" is already used as an alias by another platform`,
      );
    }
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
