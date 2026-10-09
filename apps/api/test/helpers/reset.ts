import type { PrismaService } from '../../src/prisma/prisma.service';

const TABLES = [
  'import_queue_state',
  'recognized_items',
  'llm_settings',
  'unrecognized_items',
  'import_jobs',
  'game_images',
  'games',
  'sessions',
  'users',
  'platform_aliases',
  'platforms',
] as const;

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\``);
  }
}
