import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UsersService } from '../auth/users.service';
import { parseUsersArgs, UsageError } from './args';
import { createPasswordReader } from './prompt';
import { runUsersCli } from './run-users';

async function main(): Promise<void> {
  let app: INestApplicationContext | undefined;
  try {
    const args = parseUsersArgs(process.argv.slice(2));
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    process.exitCode = await runUsersCli(args, {
      users: app.get(UsersService),
      readPassword: createPasswordReader(),
      confirm: process.stdin.isTTY,
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
