import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUTH_CONFIG, loadAuthConfig } from './auth.config';
import { PasswordService } from './password.service';
import { SessionCleanupService } from './session-cleanup.service';
import { SessionsService } from './sessions.service';
import { UsersService } from './users.service';

@Module({
  providers: [
    PasswordService,
    UsersService,
    SessionsService,
    SessionCleanupService,
    {
      provide: AUTH_CONFIG,
      useFactory: loadAuthConfig,
      inject: [ConfigService],
    },
  ],
  exports: [AUTH_CONFIG, PasswordService, UsersService, SessionsService],
})
export class AuthModule {}
