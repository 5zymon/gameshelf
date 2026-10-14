// Runs `next dev` / `next start` on WEB_PORT / WEB_HOST from the root `.env`.
// Next's CLI takes the port and host only as flags (or a shell `PORT`) and
// parses them before next.config.mjs loads the root `.env`, so resolve them
// here. The file is parsed, not loaded: copying it into this process would hand
// its NODE_ENV=development to `next start`.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { nextListenArgs } from './listen-args.mjs';

const [command, ...args] = process.argv.slice(2);
if (command !== 'dev' && command !== 'start') {
  console.error('Usage: node scripts/run-next.mjs <dev|start> [next options]');
  process.exit(1);
}

const rootEnvFile = resolve(import.meta.dirname, '../../../.env');
const fileEnv = existsSync(rootEnvFile)
  ? parseEnv(readFileSync(rootEnvFile, 'utf8'))
  : {};
// A variable set in the shell wins over the file, as in next.config.mjs.
const listenArgs = nextListenArgs({ ...fileEnv, ...process.env });
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

const child = spawn(
  process.execPath,
  [nextBin, command, ...listenArgs, ...args],
  { stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
