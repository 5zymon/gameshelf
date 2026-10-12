// Waits until the database accepts an authenticated query, then exits 0.
//
// Used by the Docker image CMD so the API never boots against an
// unreachable database. `docker compose restart` (and any restart that does
// not honour `depends_on`) can start the API before MySQL is ready; a
// boot-time DB failure leaves the Prisma connection pool stuck and the API
// returns 500s until the container is restarted. Gating boot on real DB
// readiness avoids that window entirely.
//
// Runs as a plain node script (CommonJS) so it needs no build step. It reads
// the same DATABASE_URL the app uses and retries a real authenticated
// `SELECT 1` until it succeeds.
'use strict';

const { createConnection } = require('mysql2/promise');

const url = new URL(process.env.DATABASE_URL);
const opts = {
  host: url.hostname,
  port: Number(url.port) || 3306,
  user: url.username,
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''),
  connectTimeout: 3000,
};

const RETRY_MS = 2000;

(async () => {
  for (;;) {
    try {
      const conn = await createConnection(opts);
      await conn.query('SELECT 1');
      await conn.end();
      process.stderr.write('[wait-for-db] database is ready\n');
      process.exit(0);
    } catch (err) {
      process.stderr.write(
        `[wait-for-db] not ready yet (${err.code || err.message}); retrying in ${RETRY_MS / 1000}s\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
})();
