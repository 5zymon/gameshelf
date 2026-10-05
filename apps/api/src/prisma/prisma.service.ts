import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({
      // Prisma 7 (Rust-free client) requires a driver adapter; `datasourceUrl`
      // was removed. The adapter accepts the raw URL and rewrites `mysql:` to
      // `mariadb:` (the mariadb driver is MySQL-compatible and parses
      // `?charset=utf8mb4`).
      adapter: new PrismaMariaDb(config.getOrThrow<string>('DATABASE_URL')),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
