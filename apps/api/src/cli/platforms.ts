import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PlatformsSyncService } from '../platforms/platforms-sync.service';
import { UsageError } from './args';
import { runPlatformsCli } from './run-platforms';

async function main(): Promise<void> {
  let app: INestApplicationContext | undefined;
  try {
    if (process.argv.slice(2).length > 0) {
      throw new UsageError('Usage: npm run platforms:sync');
    }
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const platformsSync = app.get(PlatformsSyncService);
    process.exitCode = await runPlatformsCli({
      sync: () => platformsSync.sync(),
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
