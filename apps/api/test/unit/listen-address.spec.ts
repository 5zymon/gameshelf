import { ConfigService } from '@nestjs/config';
import { loadListenAddress } from '../../src/listen-address';

function config(values: Record<string, string>): ConfigService {
  return new ConfigService(values);
}

describe('loadListenAddress (unit)', () => {
  it('defaults to port 3001 on every interface', () => {
    expect(loadListenAddress(config({}))).toEqual({
      port: 3001,
      host: undefined,
    });
  });

  it('reads API_PORT and API_HOST', () => {
    expect(
      loadListenAddress(config({ API_PORT: '4001', API_HOST: '0.0.0.0' })),
    ).toEqual({ port: 4001, host: '0.0.0.0' });
  });

  it('treats blank values as the defaults', () => {
    expect(loadListenAddress(config({ API_PORT: '', API_HOST: '  ' }))).toEqual(
      { port: 3001, host: undefined },
    );
  });

  it('trims surrounding whitespace', () => {
    expect(
      loadListenAddress(
        config({ API_PORT: ' 4001 ', API_HOST: ' 127.0.0.1 ' }),
      ),
    ).toEqual({ port: 4001, host: '127.0.0.1' });
  });

  it.each(['abc', '0', '-1', '65536', '30.5'])(
    'rejects API_PORT=%s',
    (value) => {
      expect(() => loadListenAddress(config({ API_PORT: value }))).toThrow(
        /API_PORT must be an integer between 1 and 65535/,
      );
    },
  );
});
