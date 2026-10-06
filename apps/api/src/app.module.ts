import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { SessionGuard } from './auth/session.guard';
import { GamesModule } from './games/games.module';
import { ImportJobsModule } from './import-jobs/import-jobs.module';
import { PlatformsModule } from './platforms/platforms.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { loadQueuePrefix, loadRedisConnection } from './queue/redis.config';
import { SettingsModule } from './settings/settings.module';
import { SetupModule } from './setup/setup.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` lives at the monorepo root; loading it here makes the API
      // read the same file the web app does.
      envFilePath: ['../../.env', '.env'],
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: loadRedisConnection(config),
        // Namespace the queue's Redis keys so a test run cannot see or wipe a
        // developer's dev queue (and vice versa).
        prefix: loadQueuePrefix(config),
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    GamesModule,
    ImportJobsModule,
    PlatformsModule,
    SetupModule,
    SettingsModule,
    QueueModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
