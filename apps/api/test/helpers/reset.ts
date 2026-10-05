import type { PrismaService } from '../../src/prisma/prisma.service';

const TABLES = [
  'unrecognized_items',
  'import_jobs',
  'games',
  'sessions',
  'users',
  'platforms',
] as const;

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\``);
  }
}
