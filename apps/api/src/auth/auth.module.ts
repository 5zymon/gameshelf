import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUTH_CONFIG, loadAuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionCleanupService } from './session-cleanup.service';
import { SessionsService } from './sessions.service';
import { UsersService } from './users.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
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
