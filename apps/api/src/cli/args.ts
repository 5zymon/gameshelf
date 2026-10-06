export type UsersCommand = 'create' | 'passwd';

export interface UsersCliArgs {
  command: UsersCommand;
  email: string;
}

/** Malformed argv; the entry point prints it and exits non-zero. */
export class UsageError extends Error {}

export function parseUsersArgs(argv: readonly string[]): UsersCliArgs {
  const [command, ...rest] = argv;
  if (command !== 'create' && command !== 'passwd') {
    throw new UsageError(
      'Usage: npm run user:create|user:passwd -- --email <email>',
    );
  }
  let email: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--email') {
      email = rest[i + 1];
      if (email === undefined || email.startsWith('--')) {
        throw new UsageError('--email requires an email value');
      }
      i += 1;
    } else if (
      arg === '--password' ||
      (arg?.startsWith('--password=') ?? false)
    ) {
      throw new UsageError(
        'Do not pass the password as an argument; you will be prompted instead.',
      );
    } else {
      throw new UsageError(`Unknown argument: ${String(arg)}`);
    }
  }
  if (email === undefined) {
    throw new UsageError('--email is required');
  }
  return { command, email };
}
