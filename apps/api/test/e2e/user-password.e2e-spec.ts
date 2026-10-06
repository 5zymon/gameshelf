import { NotFoundException } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { UsersService } from '../../src/auth/users.service';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';

describe('User password management (e2e)', () => {
  let test: TestApp;
  let users: UsersService;

  beforeAll(async () => {
    test = await createTestApp();
    users = test.app.get(UsersService);
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
  });

  afterAll(async () => {
    await test.app.close();
  });

  function server(): Server {
    return test.app.getHttpServer() as Server;
  }

  it('a setup-created account can log in', async () => {
    const setup = await request(server()).post('/setup').send({
      email: 'player@example.com',
      password: 'first-secret',
    });
    expect(setup.status).toBe(201);

    const login = await request(server()).post('/auth/login').send({
      email: 'player@example.com',
      password: 'first-secret',
    });
    expect(login.status).toBe(200);
  });

  it('setPassword replaces the hash: old password stops working, new one works', async () => {
    await request(server()).post('/setup').send({
      email: 'player@example.com',
      password: 'first-secret',
    });

    const before = await request(server()).post('/auth/login').send({
      email: 'player@example.com',
      password: 'first-secret',
    });
    expect(before.status).toBe(200);

    const updated = await users.setPassword({
      email: 'player@example.com',
      password: 'second-secret',
    });
    expect(updated.email).toBe('player@example.com');
    expect(updated).not.toHaveProperty('passwordHash');

    const oldLogin = await request(server()).post('/auth/login').send({
      email: 'player@example.com',
      password: 'first-secret',
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(server()).post('/auth/login').send({
      email: 'player@example.com',
      password: 'second-secret',
    });
    expect(newLogin.status).toBe(200);
  });

  it('setPassword rejects an unknown email with NotFoundException', async () => {
    await expect(
      users.setPassword({
        email: 'ghost@example.com',
        password: 'whatever',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a createUser account can log in immediately', async () => {
    await users.createUser({
      email: 'created@example.com',
      password: 'created-secret',
    });

    const login = await request(server()).post('/auth/login').send({
      email: 'created@example.com',
      password: 'created-secret',
    });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({
      user: { email: 'created@example.com' },
    });
  });
});
