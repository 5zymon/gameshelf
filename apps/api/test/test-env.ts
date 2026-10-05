import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

export const DEFAULT_TEST_DATABASE_URL =
  'mysql://gameshelf:gameshelf@127.0.0.1:3306/gameshelf_test?charset=utf8mb4';

export function resolveTestDatabaseUrl(): string {
  loadEnv({
    path: [resolve(__dirname, '../../.env'), resolve(__dirname, '../.env')],
    quiet: true,
  });
  return process.env.DATABASE_TEST_URL ?? DEFAULT_TEST_DATABASE_URL;
}
