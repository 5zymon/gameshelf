import { ConflictException, NotFoundException } from '@nestjs/common';
import { Readable, Writable } from 'node:stream';
import { parseUsersArgs, UsageError } from '../../src/cli/args';
import { createPasswordReader } from '../../src/cli/prompt';
import { runUsersCli, type UsersCliDeps } from '../../src/cli/run-users';

interface UsersMock {
  createUser: jest.Mock;
  setPassword: jest.Mock;
}

interface Harness {
  deps: UsersCliDeps;
  users: UsersMock;
  out: string[];
  err: string[];
}

function createHarness(overrides: Partial<UsersCliDeps> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const users: UsersMock = { createUser: jest.fn(), setPassword: jest.fn() };
  const deps: UsersCliDeps = {
    users,
    readPassword: jest.fn(),
    confirm: false,
    out: (line) => {
      out.push(line);
    },
    err: (line) => {
      err.push(line);
    },
    ...overrides,
  };
  return { deps, users, out, err };
}

function capturingWritable(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, text: () => chunks.join('') };
}

describe('parseUsersArgs', () => {
  it('parses the create command with an email', () => {
    expect(parseUsersArgs(['create', '--email', 'player@example.com'])).toEqual(
      {
        command: 'create',
        email: 'player@example.com',
      },
    );
  });

  it('parses the passwd command with an email', () => {
    expect(parseUsersArgs(['passwd', '--email', 'player@example.com'])).toEqual(
      {
        command: 'passwd',
        email: 'player@example.com',
      },
    );
  });

  it('rejects a missing or unknown command', () => {
    expect(() => parseUsersArgs([])).toThrow(UsageError);
    expect(() => parseUsersArgs(['delete', '--email', 'a@b.c'])).toThrow(
      UsageError,
    );
  });

  it('requires --email', () => {
    expect(() => parseUsersArgs(['create'])).toThrow('--email is required');
  });

  it('requires a value after --email', () => {
    expect(() => parseUsersArgs(['create', '--email'])).toThrow(
      '--email requires an email value',
    );
    expect(() => parseUsersArgs(['create', '--email', '--wat'])).toThrow(
      '--email requires an email value',
    );
  });

  it('rejects a password passed as an argument', () => {
    expect(() =>
      parseUsersArgs(['create', '--email', 'a@b.c', '--password', 'secret']),
    ).toThrow('Do not pass the password');
    expect(() =>
      parseUsersArgs(['create', '--email', 'a@b.c', '--password=secret']),
    ).toThrow('Do not pass the password');
  });

  it('rejects an unknown flag', () => {
    expect(() =>
      parseUsersArgs(['create', '--email', 'a@b.c', '--admin']),
    ).toThrow('Unknown argument: --admin');
  });
});

describe('runUsersCli', () => {
  it('creates a user and returns 0', async () => {
    const harness = createHarness({
      readPassword: jest.fn().mockResolvedValue('pikachu123'),
    });
    harness.users.createUser.mockResolvedValue({
      id: 1,
      email: 'ash@example.com',
      createdAt: new Date('2026-10-05T12:00:00.000Z'),
    });

    const code = await runUsersCli(
      { command: 'create', email: 'ash@example.com' },
      harness.deps,
    );

    expect(code).toBe(0);
    expect(harness.users.createUser).toHaveBeenCalledWith({
      email: 'ash@example.com',
      password: 'pikachu123',
    });
    expect(harness.out.join('\n')).toContain(
      'Created user 1 <ash@example.com>',
    );
  });

  it('sets a password and returns 0', async () => {
    const harness = createHarness({
      readPassword: jest.fn().mockResolvedValue('new-secret'),
    });
    harness.users.setPassword.mockResolvedValue({
      id: 2,
      email: 'misty@example.com',
      createdAt: new Date('2026-10-05T12:00:00.000Z'),
    });

    const code = await runUsersCli(
      { command: 'passwd', email: 'misty@example.com' },
      harness.deps,
    );

    expect(code).toBe(0);
    expect(harness.users.setPassword).toHaveBeenCalledWith({
      email: 'misty@example.com',
      password: 'new-secret',
    });
    expect(harness.out.join('\n')).toContain(
      'Updated password for user 2 <misty@example.com>',
    );
  });

  it('rejects an empty password without calling the service', async () => {
    const harness = createHarness({
      readPassword: jest.fn().mockResolvedValue(''),
    });

    const code = await runUsersCli(
      { command: 'create', email: 'ash@example.com' },
      harness.deps,
    );

    expect(code).toBe(1);
    expect(harness.users.createUser).not.toHaveBeenCalled();
    expect(harness.err.join('\n')).toContain('password must not be empty');
  });

  it('rejects a confirmation mismatch without calling the service', async () => {
    const harness = createHarness({
      readPassword: jest
        .fn()
        .mockResolvedValueOnce('one')
        .mockResolvedValueOnce('two'),
      confirm: true,
    });

    const code = await runUsersCli(
      { command: 'create', email: 'ash@example.com' },
      harness.deps,
    );

    expect(code).toBe(1);
    expect(harness.users.createUser).not.toHaveBeenCalled();
    expect(harness.err.join('\n')).toContain('passwords do not match');
  });

  it('reports a duplicate-email conflict (create) and returns 1', async () => {
    const harness = createHarness({
      readPassword: jest.fn().mockResolvedValue('pikachu123'),
    });
    harness.users.createUser.mockRejectedValue(
      new ConflictException(
        'A user with email "ash@example.com" already exists',
      ),
    );

    const code = await runUsersCli(
      { command: 'create', email: 'ash@example.com' },
      harness.deps,
    );

    expect(code).toBe(1);
    expect(harness.err.join('\n')).toBe(
      'Error: A user with email "ash@example.com" already exists',
    );
  });

  it('reports an unknown email (passwd) and returns 1', async () => {
    const harness = createHarness({
      readPassword: jest.fn().mockResolvedValue('new-secret'),
    });
    harness.users.setPassword.mockRejectedValue(
      new NotFoundException('No user with email "ghost@example.com" was found'),
    );

    const code = await runUsersCli(
      { command: 'passwd', email: 'ghost@example.com' },
      harness.deps,
    );

    expect(code).toBe(1);
    expect(harness.err.join('\n')).toBe(
      'Error: No user with email "ghost@example.com" was found',
    );
  });
});

describe('createPasswordReader (non-TTY)', () => {
  it('reads exactly one line and never writes the secret to the output', async () => {
    const input = Readable.from(['secret\n']);
    const capture = capturingWritable();
    const readPassword = createPasswordReader({
      input,
      output: capture.stream,
    });

    await expect(readPassword('Password: ')).resolves.toBe('secret');
    expect(capture.text()).not.toContain('secret');
  });

  it('returns an empty string on EOF', async () => {
    const input = Readable.from([]);
    const capture = capturingWritable();
    const readPassword = createPasswordReader({
      input,
      output: capture.stream,
    });

    await expect(readPassword('Password: ')).resolves.toBe('');
  });
});

describe('createPasswordReader (TTY)', () => {
  function ttyInput(chunks: readonly string[]): Readable & { isTTY: boolean } {
    const input = Readable.from(chunks) as Readable & { isTTY?: boolean };
    input.isTTY = true;
    return input as Readable & { isTTY: boolean };
  }

  it('resolves the secret without echoing it', async () => {
    const capture = capturingWritable();
    const readPassword = createPasswordReader({
      input: ttyInput(['secret\n']),
      output: capture.stream,
    });

    await expect(readPassword('Password: ')).resolves.toBe('secret');
    expect(capture.text()).toContain('Password: ');
    expect(capture.text()).not.toContain('secret');
  });

  it('rejects instead of hanging when the prompt is aborted (Ctrl-D/EOF)', async () => {
    const capture = capturingWritable();
    const readPassword = createPasswordReader({
      input: ttyInput([]),
      output: capture.stream,
    });

    await expect(readPassword('Password: ')).rejects.toThrow(
      'Password prompt aborted',
    );
    expect(capture.text()).toContain('Password: ');
  });
});
