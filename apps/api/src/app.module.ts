import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { SetupModule } from './setup/setup.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` lives at the monorepo root; loading it here makes the API
      // read the same file the web app does.
      envFilePath: ['../../.env', '.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    GamesModule,
    ImportJobsModule,
    PlatformsModule,
    SetupModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
