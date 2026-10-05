import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { UsersService } from '../../src/auth/users.service';
import { createGlobalValidationPipe } from '../../src/common/validation-pipe';
import { PrismaService } from '../../src/prisma/prisma.service';

export const TEST_USER_EMAIL = 'e2e-player@example.com';
export const TEST_USER_PASSWORD = 'correct horse battery staple';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  request: ReturnType<typeof request.agent>;
  login: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(createGlobalValidationPipe());
  await app.init();
  const server = app.getHttpServer() as Server;
  const agent = request.agent(server);
  const users = app.get(UsersService);

  return {
    app,
    prisma: app.get(PrismaService),
    request: agent,
    async login(): Promise<void> {
      await users.createUser({
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
      });
      const res = await agent
        .post('/auth/login')
        .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });
      if (res.status !== 200) {
        throw new Error(`test login failed: ${String(res.status)}`);
      }
    },
  };
}
