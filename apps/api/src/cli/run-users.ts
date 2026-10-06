import { HttpException } from '@nestjs/common';
import type {
  CreateUserInput,
  CreatedUser,
  SetPasswordInput,
} from '../auth/users.service';
import type { UsersCliArgs } from './args';
import type { PasswordReader } from './prompt';

export interface UsersCliService {
  createUser(input: CreateUserInput): Promise<CreatedUser>;
  setPassword(input: SetPasswordInput): Promise<CreatedUser>;
}

export interface UsersCliDeps {
  users: UsersCliService;
  readPassword: PasswordReader;
  /** Ask twice and require a match (interactive TTY only). */
  confirm: boolean;
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
  const password = await deps.readPassword('Password: ');
  if (password.length === 0) {
    deps.err('Error: password must not be empty.');
    return 1;
  }
  if (deps.confirm) {
    const confirmation = await deps.readPassword('Confirm password: ');
    if (confirmation !== password) {
      deps.err('Error: passwords do not match.');
      return 1;
    }
  }

  try {
    if (args.command === 'create') {
      const user = await deps.users.createUser({ email: args.email, password });
      deps.out(`Created user ${String(user.id)} <${user.email}>`);
    } else {
      const user = await deps.users.setPassword({
        email: args.email,
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
