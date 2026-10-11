import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export type PasswordReader = (promptText: string) => Promise<string>;
export type LineReader = (promptText: string) => Promise<string>;

export interface PasswordReaderStreams {
  input?: Readable & { isTTY?: boolean };
  output?: Writable;
}

/**
 * Reads exactly one line from a non-TTY stream. `readline`'s `line` event
 * cannot be used here: when stdin has already been written and closed before
 * the read starts (the normal piped/CLI case, where Nest boots first), the
 * interface emits `close` before `line`, so a `close`-resolves-empty listener
 * wins the race and the password is lost. Collecting chunks directly and
 * settling on the first newline or on end is race-free.
 */
function readLine(input: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const done = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      const [first] = buffer.split('\n');
      resolve((first ?? '').replace(/\r$/, ''));
    };
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      if (buffer.includes('\n')) {
        done();
      }
    };
    const onEnd = (): void => {
      done();
    };
    const onError = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      reject(error);
    };
    input.on('data', onData);
    input.on('end', onEnd);
    input.on('error', onError);
  });
}

/**
 * Prompts on a TTY and reads one line, optionally without echoing it. A Ctrl-D
 * / EOF at the prompt makes readline emit `close` without ever calling the
 * question callback, so `close` must settle the promise or the CLI hangs
 * forever instead of exiting non-zero.
 *
 * The prompt must go through `question()`: readline's refresh (`kRefreshLine`)
 * writes `cursorTo(output, 0)` and `clearScreenDown(output)` **directly to the
 * stream**, bypassing `_writeToOutput`. That refresh runs when `question()`
 * first renders the prompt and again on edits such as backspace or delete;
 * plain characters typed at the end of the line are appended with no clear. A
 * prompt pre-written before `question()` is therefore erased at `prompt()`,
 * before any typing. Letting `question()` own the prompt means the refresh
 * redraws it after the clear.
 */
function readTtyLine(
  input: Readable,
  output: Writable,
  promptText: string,
  echo: boolean,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const rl = createInterface({ input, output, terminal: true });
    if (!echo) {
      // readline has no public no-echo switch; overriding the private writer
      // is the documented workaround. A refresh redraws `prompt + line` after
      // clearing the row; keep the prompt, drop the typed secret.
      (
        rl as unknown as { _writeToOutput: (text: string) => void }
      )._writeToOutput = (text: string): void => {
        if (text.startsWith(promptText)) {
          output.write(promptText);
        }
      };
    }

    let answered = false;
    function onError(error: Error): void {
      if (answered) {
        return;
      }
      answered = true;
      rl.removeListener('close', onClose);
      reject(error);
    }
    function onClose(): void {
      if (answered) {
        return;
      }
      answered = true;
      rl.removeListener('error', onError);
      reject(new Error(echo ? 'Prompt aborted' : 'Password prompt aborted'));
    }
    rl.once('error', onError);
    rl.once('close', onClose);
    rl.question(promptText, (answer) => {
      if (answered) {
        return;
      }
      answered = true;
      rl.removeListener('error', onError);
      rl.removeListener('close', onClose);
      rl.close();
      // The no-echo override drops readline's own newline along with the typed
      // secret, so hidden mode must add one. Visible mode already got readline's
      // newline; a second one would leave a blank line after the answer.
      if (!echo) {
        output.write('\n');
      }
      resolve(answer);
    });
  });
}

/**
 * Prompts for a secret without echoing it on a TTY. When stdin is not a TTY
 * (piped input / CI) it reads one line — nothing is echoed anyway. No
 * environment variable is consulted, so the secret never reaches argv/env.
 */
export function createPasswordReader(
  streams: PasswordReaderStreams = {},
): PasswordReader {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;
  return (promptText) => {
    if (input.isTTY !== true) {
      return readLine(input);
    }
    return readTtyLine(input, output, promptText, false);
  };
}

/**
 * Prompts for a visible line on a TTY (normal readline echo), so the user can
 * see and edit what they type. Off a TTY it reads one line and prints no
 * prompt. Callers only reach the TTY branch in practice (the CLI checks
 * `interactive` first), but the reader stays total.
 */
export function createLineReader(
  streams: PasswordReaderStreams = {},
): LineReader {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;
  return (promptText) => {
    if (input.isTTY !== true) {
      return readLine(input);
    }
    return readTtyLine(input, output, promptText, true);
  };
}
