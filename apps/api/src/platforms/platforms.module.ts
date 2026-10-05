import { Module } from '@nestjs/common';
import { PlatformsController } from './platforms.controller';
import { PlatformsService } from './platforms.service';

@Module({
  controllers: [PlatformsController],
  providers: [PlatformsService],
})
export class PlatformsModule {}
