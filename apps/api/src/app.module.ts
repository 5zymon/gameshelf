import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GamesModule } from './games/games.module';
import { PlatformsModule } from './platforms/platforms.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` lives at the monorepo root; loading it here makes the API
      // read the same file the web app does.
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    GamesModule,
    PlatformsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
