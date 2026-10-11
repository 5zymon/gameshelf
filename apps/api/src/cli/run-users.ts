import { HttpException } from '@nestjs/common';
import type {
  CreateUserInput,
  CreatedUser,
  SetPasswordInput,
} from '../auth/users.service';
import type { UsersCliArgs } from './args';
import type { LineReader, PasswordReader } from './prompt';

export interface UsersCliService {
  createUser(input: CreateUserInput): Promise<CreatedUser>;
  setPassword(input: SetPasswordInput): Promise<CreatedUser>;
}

export interface UsersCliDeps {
  users: UsersCliService;
  readPassword: PasswordReader;
  /** Visible prompt (email). */
  readLine: LineReader;
  /** stdin is a TTY: prompt for a missing email and confirm the password. */
  interactive: boolean;
  out: (line: string) => void;
  err: (line: string) => void;
}

function describeError(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') {
      return response;
    }
    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export async function runUsersCli(
  args: UsersCliArgs,
  deps: UsersCliDeps,
): Promise<number> {
  let email = args.email;
  if (email === undefined) {
    if (!deps.interactive) {
      deps.err('Error: --email is required when not running in a terminal.');
      return 1;
    }
    email = (await deps.readLine('Email: ')).trim();
  }
  if (email.trim() === '') {
    deps.err('Error: email must not be empty.');
    return 1;
  }

  const password = args.password ?? (await deps.readPassword('Password: '));
  if (password.length === 0) {
    deps.err('Error: password must not be empty.');
    return 1;
  }
  if (args.password === undefined && deps.interactive) {
    const confirmation = await deps.readPassword('Confirm password: ');
    if (confirmation !== password) {
      deps.err('Error: passwords do not match.');
      return 1;
    }
  }

  try {
    if (args.command === 'create') {
      const user = await deps.users.createUser({ email, password });
      deps.out(`Created user ${String(user.id)} <${user.email}>`);
    } else {
      const user = await deps.users.setPassword({
        email,
        password,
      });
      deps.out(`Updated password for user ${String(user.id)} <${user.email}>`);
    }
    return 0;
  } catch (error) {
    deps.err(`Error: ${describeError(error)}`);
    return 1;
  }
}
