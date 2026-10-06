import { ConfigService } from '@nestjs/config';
import { LlmKeyCryptoService } from '../../src/settings/llm-key-crypto.service';

function createService(
  values: Record<string, string | undefined>,
): LlmKeyCryptoService {
  const config = {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService;
  return new LlmKeyCryptoService(config);
}

describe('LlmKeyCryptoService (unit)', () => {
  const secret = { LLM_SETTINGS_SECRET: 'unit-secret-0123456789abcdef' };

  it('round-trips a value', () => {
    const service = createService(secret);
    const plain = 'sk-super-secret-value';
    const ciphertext = service.encrypt(plain);

    expect(ciphertext).not.toContain(plain);
    expect(service.decrypt(ciphertext)).toBe(plain);
  });

  it('emits the versioned format v1:<iv>:<tag>:<ciphertext>', () => {
    const service = createService(secret);
    const parts = service.encrypt('hello').split(':');

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(parts.slice(1).every((part) => part.length > 0)).toBe(true);
  });

  it('produces a different ciphertext for the same plaintext (random IV)', () => {
    const service = createService(secret);

    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('fails to decrypt with a different secret', () => {
    const ciphertext = createService(secret).encrypt('hello');
    const other = createService({
      LLM_SETTINGS_SECRET: 'another-secret-987654321',
    });

    expect(() => other.decrypt(ciphertext)).toThrow();
  });

  it('fails to decrypt a tampered ciphertext', () => {
    const service = createService(secret);
    const ciphertext = service.encrypt('hello');
    const parts = ciphertext.split(':');
    // Flip the auth tag.
    const tampered = [parts[0], parts[1], 'AAAA', parts[3]].join(':');

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('rejects a malformed payload', () => {
    const service = createService(secret);

    expect(() => service.decrypt('not-a-ciphertext')).toThrow();
  });

  it('falls back to SESSION_SECRET when LLM_SETTINGS_SECRET is absent', () => {
    const service = createService({
      SESSION_SECRET: 'session-secret-0123456789',
    });

    expect(service.decrypt(service.encrypt('hi'))).toBe('hi');
  });

  it('throws when neither secret is configured', () => {
    expect(() => createService({})).toThrow();
    expect(() => createService({ LLM_SETTINGS_SECRET: '   ' })).toThrow();
  });
});
