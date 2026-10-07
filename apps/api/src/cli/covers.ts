import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CoverRecoveryService } from '../covers/cover-recovery.service';
import { UsageError } from './args';
import { runCoversCli } from './run-covers';

async function main(): Promise<void> {
  let app: INestApplicationContext | undefined;
  try {
    if (process.argv.slice(2).length > 0) {
      throw new UsageError('Usage: npm run covers:redownload');
    }
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const recovery = app.get(CoverRecoveryService);
    process.exitCode = await runCoversCli({
      redownload: () => recovery.redownloadMissing(),
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
