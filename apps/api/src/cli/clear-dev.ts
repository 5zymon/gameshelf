import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { parseClearDevArgs, UsageError } from './args';
import { clearDevData, countDevData } from './dev-data';
import { createLineReader } from './prompt';
import { runClearDevCli, describeDatabaseTarget } from './run-clear-dev';

async function main(): Promise<void> {
  let app: INestApplicationContext | undefined;
  try {
    const args = parseClearDevArgs(process.argv.slice(2));
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const prisma = app.get(PrismaService);
    // Read NODE_ENV through ConfigService so the root `.env` is honored (and
    // an existing process env wins, so `NODE_ENV=test npm run db:clear-dev` is
    // still refused).
    const config = app.get(ConfigService);
    process.exitCode = await runClearDevCli({
      nodeEnv: config.get<string>('NODE_ENV'),
      force: args.force,
      interactive: process.stdin.isTTY,
      // Show only host + database, never the userinfo: the connection string
      // can carry a password and this header is printed.
      target: describeDatabaseTarget(config.get<string>('DATABASE_URL')),
      count: () => countDevData(prisma),
      clear: () => clearDevData(prisma),
      readLine: createLineReader(),
      out: (line) => {
        process.stdout.write(`${line}\n`);
      },
      err: (line) => {
        process.stderr.write(`${line}\n`);
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      error instanceof UsageError ? `${message}\n` : `Error: ${message}\n`,
    );
    process.exitCode = 1;
  } finally {
    await app?.close(); // disconnects Prisma and stops ScheduleModule timers
  }
}

void main();
