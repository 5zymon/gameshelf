import {
  GAME_ALREADY_IN_CATALOG,
  type GameConflictErrorBody,
} from './contracts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface ApiErrorInput {
  status: number;
  url: string;
  body: unknown;
  message: string;
  code?: string | null;
  cause?: unknown;
}

/**
 * The single typed error every API call rejects with. A real HTTP failure
 * carries its status; a network/DNS failure uses status `0`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  readonly code: string | null;

  constructor(input: ApiErrorInput) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = 'ApiError';
    this.status = input.status;
    this.url = input.url;
    this.body = input.body;
    this.code = input.code ?? null;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isValidation(): boolean {
    return this.status === 400;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** Nest `message` (string | string[]) as a string[]; never empty. */
  get messages(): string[] {
    if (isRecord(this.body)) {
      const message = this.body.message;
      if (typeof message === 'string' && message !== '') return [message];
      if (Array.isArray(message)) {
        const list: unknown[] = message;
        const strings = list.filter(
          (item): item is string => typeof item === 'string',
        );
        if (strings.length > 0) return strings;
      }
    }
    return [this.message];
  }

  get userMessage(): string {
    return this.messages[0] ?? this.message;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isGameConflict(
  error: unknown,
): error is ApiError & { body: GameConflictErrorBody } {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    isRecord(error.body) &&
    error.body.code === GAME_ALREADY_IN_CATALOG
  );
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function pickMessage(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    const message = body.message;
    if (typeof message === 'string' && message !== '') return message;
    if (Array.isArray(message)) {
      const list: unknown[] = message;
      const first = list.find(
        (item): item is string => typeof item === 'string' && item !== '',
      );
      if (first !== undefined) return first;
    }
  }
  return fallback;
}

function pickCode(body: unknown): string | null {
  return isRecord(body) && typeof body.code === 'string' ? body.code : null;
}

/**
 * Reproduces the Nest default error body (`{ statusCode, message, error }`)
 * and the `ConflictException({ ...code, game })` object form. Non-JSON bodies
 * (proxy/HTML on 502/504) degrade to the raw text.
 */
export async function apiErrorFromResponse(
  response: Response,
  url: string,
): Promise<ApiError> {
  const body = await readBody(response);
  return new ApiError({
    status: response.status,
    url,
    body,
    message: pickMessage(
      body,
      `Request failed (HTTP ${String(response.status)})`,
    ),
    code: pickCode(body),
  });
}
