import { Module } from '@nestjs/common';
import { GameIdentityService } from './game-identity.service';

@Module({ providers: [GameIdentityService], exports: [GameIdentityService] })
export class GameIdentityModule {}
