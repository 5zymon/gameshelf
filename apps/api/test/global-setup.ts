import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { resolveTestDatabaseUrl } from './test-env';

const TABLES = [
  'llm_settings',
  'unrecognized_items',
  'import_jobs',
  'games',
  'sessions',
  'users',
  'platforms',
] as const;

export default async function globalSetup(): Promise<void> {
  const testUrl = resolveTestDatabaseUrl();
  const url = new URL(testUrl);
  const dbName = url.pathname.replace(/^\//, '');
  const conn = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    multipleStatements: true,
  });
  try {
    try {
      await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
    } catch {
      throw new Error(
        `Cannot create the test database "${dbName}". On a fresh docker-compose data dir this is done ` +
          'automatically by docker/mysql-init/02-test-database.sql; on an existing one, run it once: ' +
          'docker compose exec -T mysql mysql -uroot -p<MYSQL_ROOT_PASSWORD> < docker/mysql-init/02-test-database.sql',
      );
    }
    await conn.changeUser({ database: dbName });

    const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error('prisma migrate deploy failed against the test database');
    }

    await conn.query(TABLES.map((t) => `DELETE FROM \`${t}\``).join('; '));
  } finally {
    await conn.end();
  }
}
