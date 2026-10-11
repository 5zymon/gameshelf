export type UsersCommand = 'create' | 'passwd';

export interface UsersCliArgs {
  command: UsersCommand;
  email?: string;
  password?: string;
}

/** Malformed argv; the entry point prints it and exits non-zero. */
export class UsageError extends Error {}

export function parseUsersArgs(argv: readonly string[]): UsersCliArgs {
  const [command, ...rest] = argv;
  if (command !== 'create' && command !== 'passwd') {
    throw new UsageError(
      'Usage: npm run user:create|user:passwd -- [--email <email>] [--password <password>]',
    );
  }
  let email: string | undefined;
  let password: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--email') {
      email = rest[i + 1];
      if (email === undefined || email.startsWith('--')) {
        throw new UsageError('--email requires an email value');
      }
      i += 1;
    } else if (arg === '--password') {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError('--password requires a value');
      }
      password = value;
      i += 1;
    } else if (arg?.startsWith('--password=')) {
      password = arg.slice('--password='.length);
    } else {
      // A typo like `--passwrod=secret` must not echo the value to stderr. The
      // reviewer's own example is a transposition, so no prefix test on
      // `--password` is reliable; drop everything from the first `=` for any
      // unknown flag and report the flag name alone.
      const flag = arg?.split('=', 1)[0] ?? arg;
      throw new UsageError(`Unknown argument: ${String(flag)}`);
    }
  }
  return { command, email, password };
}

export interface ClearDevArgs {
  force: boolean;
}

export function parseClearDevArgs(argv: readonly string[]): ClearDevArgs {
  let force = false;
  for (const arg of argv) {
    if (arg === '--force') {
      force = true;
    } else {
      throw new UsageError(`Unknown argument: ${arg}`);
    }
  }
  return { force };
}
