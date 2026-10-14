import { ConfigService } from '@nestjs/config';

export const DEFAULT_API_PORT = 3001;

export interface ListenAddress {
  port: number;
  /** Bind address; `undefined` = Node's default, every interface (IPv4 + IPv6). */
  host: string | undefined;
}

/** Reads `API_PORT` and `API_HOST`; a blank value means the default. */
export function loadListenAddress(config: ConfigService): ListenAddress {
  const rawPort = config.get<string>('API_PORT')?.trim();
  const port =
    rawPort === undefined || rawPort === ''
      ? DEFAULT_API_PORT
      : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `API_PORT must be an integer between 1 and 65535 (got "${rawPort ?? ''}")`,
    );
  }
  const rawHost = config.get<string>('API_HOST')?.trim();
  return {
    port,
    host: rawHost === undefined || rawHost === '' ? undefined : rawHost,
  };
}
