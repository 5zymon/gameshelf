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
//
// It fails fast (exit 1) on errors that retrying cannot fix — bad
// credentials, a missing database, or an unparseable DATABASE_URL — and caps
// the wait (TIMEOUT_MS) so a database that never becomes ready surfaces as a
// container failure (the `unless-stopped` restart then retries it) instead of
// looping forever.
'use strict';

const { createConnection } = require('mysql2/promise');

const RETRY_MS = 2000;
const TIMEOUT_MS = 120000; // hard cap on the wait before giving up

// Errors that retrying cannot fix: the server answered and rejected us (bad
// credentials / missing database). Exit immediately instead of looping.
const PERMANENT_CODES = new Set([
  'ER_ACCESS_DENIED_ERROR',
  'ER_DBACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
]);

function isPermanent(err) {
  return PERMANENT_CODES.has(err.code);
}

let opts;
try {
  const url = new URL(process.env.DATABASE_URL);
  opts = {
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectTimeout: 3000,
  };
} catch (err) {
  process.stderr.write(
    `[wait-for-db] invalid DATABASE_URL (${err.message}); not retrying\n`,
  );
  process.exit(1);
}

(async () => {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    let conn;
    try {
      conn = await createConnection(opts);
      await conn.query('SELECT 1');
      await conn.end();
      process.stderr.write('[wait-for-db] database is ready\n');
      process.exit(0);
    } catch (err) {
      if (isPermanent(err)) {
        process.stderr.write(
          `[wait-for-db] permanent error (${err.code || err.message}); not retrying\n`,
        );
        process.exit(1);
      }
      if (Date.now() >= deadline) {
        process.stderr.write(
          `[wait-for-db] still not ready after ${TIMEOUT_MS / 1000}s (${err.code || err.message}); giving up\n`,
        );
        process.exit(1);
      }
      process.stderr.write(
        `[wait-for-db] not ready yet (${err.code || err.message}); retrying in ${RETRY_MS / 1000}s\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    } finally {
      // Close any connection left open (a failed query can leave a socket
      // behind) so the next attempt starts clean. The exit paths above
      // terminate the process before this runs.
      if (conn) await conn.end().catch(() => {});
    }
  }
})();
