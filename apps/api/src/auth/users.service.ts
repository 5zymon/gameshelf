import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';

export interface CreateUserInput {
  email: string;
  password: string;
}

export interface CreatedUser {
  id: number;
  email: string;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async createUser(input: CreateUserInput): Promise<CreatedUser> {
    const email = input.email.trim().toLowerCase();
    if (email === '') {
      throw new BadRequestException('email must not be blank');
    }
    if (input.password.length === 0) {
      throw new BadRequestException('password must not be empty');
    }
    const passwordHash = await this.passwords.hash(input.password);
    try {
      return await this.prisma.user.create({
        data: { email, passwordHash },
        select: { id: true, email: true, createdAt: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `A user with email "${email}" already exists`,
        );
      }
      throw error;
    }
  }
}
