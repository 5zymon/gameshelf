#!/usr/bin/env node
/**
 * Fetches the canonical IGDB platform list and prints a Prisma data-migration
 * (SQL) to stdout.
 *
 * Usage (from the repo root):
 *   ts=$(date -u +%Y%m%d%H%M%S)
 *   mkdir -p "apps/api/prisma/migrations/${ts}_seed_igdb_platforms"
 *   npm run db:platforms:fetch --silent > "apps/api/prisma/migrations/${ts}_seed_igdb_platforms/migration.sql"
 *
 * Reads IGDB_CLIENT_ID / IGDB_CLIENT_SECRET from the repo-root .env.
 * Output is an idempotent upsert keyed on the unique `name` (case-insensitive
 * collation); `slug` is never rewritten, so existing custom slugs survive.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function loadRootEnv() {
  const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (!existsSync(envPath)) {
    console.error(
      `Missing .env file at ${envPath} — create it with IGDB_CLIENT_ID and IGDB_CLIENT_SECRET (see .env.example).`,
    );
    process.exit(1);
  }
  const vars = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) {
      vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return vars;
}

const { IGDB_CLIENT_ID, IGDB_CLIENT_SECRET } = loadRootEnv();
if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
  console.error('IGDB_CLIENT_ID / IGDB_CLIENT_SECRET are missing in .env');
  process.exit(1);
}

// 1) OAuth client-credentials token
const tokenRes = await fetch('https://api.igdb.com/v4/access_token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body:
    `client_id=${encodeURIComponent(IGDB_CLIENT_ID)}` +
    `&client_secret=${encodeURIComponent(IGDB_CLIENT_SECRET)}`,
});
if (!tokenRes.ok) {
  console.error(`access_token ${tokenRes.status}: ${await tokenRes.text()}`);
  process.exit(1);
}
const { token } = await tokenRes.json();

// 2) All platforms — ~155 rows, one `limit 500` page
const platforms = [];
for (let offset = 0; ; offset += 500) {
  const res = await fetch(
    `https://api.igdb.com/v4/platforms?fields=name,abbreviation,alternative_name,slug;limit=500 offset=${offset};`,
    {
      headers: {
        'Client-ID': IGDB_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!res.ok) {
    console.error(`platforms ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const page = await res.json();
  platforms.push(...page);
  if (page.length < 500) {
    break;
  }
}

platforms.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "''");
const sql = (v) => (v === undefined || v === null ? 'NULL' : `'${esc(v)}'`);

const lines = [
  '/*',
  '  Seed: canonical IGDB platform list (ticket 1.4).',
  `  Fetched ${new Date().toISOString()} from https://api.igdb.com/v4/platforms`,
  '  (fields: name, abbreviation, alternative_name, slug).',
  '  Idempotent upsert keyed on unique `name` (ci collation); `slug` is never',
  '  rewritten, so existing custom slugs survive. The update is guarded on a',
  '  name match, so a slug collision with a custom platform leaves its',
  '  canonical fields untouched. Regenerate with',
  '  `npm run db:platforms:fetch` (see apps/api/prisma/igdb-platforms.mjs).',
  '*/',
  '',
];
for (const p of platforms) {
  lines.push(
    `INSERT INTO platforms (name, abbreviation, alternative_name, igdb_id, slug) VALUES (${sql(p.name)}, ${sql(p.abbreviation)}, ${sql(p.alternative_name)}, ${p.id}, ${sql(p.slug)}) AS p ON DUPLICATE KEY UPDATE platforms.abbreviation = IF(platforms.name = p.name, p.abbreviation, platforms.abbreviation), platforms.alternative_name = IF(platforms.name = p.name, p.alternative_name, platforms.alternative_name), platforms.igdb_id = IF(platforms.name = p.name, p.igdb_id, platforms.igdb_id);`,
  );
}
console.log(lines.join('\n'));
console.error(`wrote ${platforms.length} platforms`);
