import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UsersService } from '../auth/users.service';
import { PlatformsService } from '../platforms/platforms.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageError } from './args';
import { describeDatabaseTarget } from './run-clear-dev';
import { seedDevData } from './seed-data';
import { runSeedCli } from './run-seed';

async function main(): Promise<void> {
  let app: INestApplicationContext | undefined;
  try {
    if (process.argv.slice(2).length > 0) {
      throw new UsageError('Usage: npm run db:seed');
    }
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    // Read NODE_ENV through ConfigService so the root `.env` is honored (and
    // an existing process env wins, so `NODE_ENV=test npm run db:seed` is
    // still refused).
    const config = app.get(ConfigService);
    const prisma = app.get(PrismaService);
    const users = app.get(UsersService);
    const platforms = app.get(PlatformsService);
    process.exitCode = await runSeedCli({
      nodeEnv: config.get<string>('NODE_ENV'),
      // Show only host + database, never the userinfo: the connection string
      // can carry a password and this header is printed.
      target: describeDatabaseTarget(config.get<string>('DATABASE_URL')),
      seed: () => seedDevData({ prisma, users, platforms }),
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
