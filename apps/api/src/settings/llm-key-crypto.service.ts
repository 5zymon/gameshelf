import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_INFO = 'aes-256-gcm-key';
const KEY_SALT = 'gameshelf-llm-settings';
const VERSION = 'v1';

/**
 * Encrypts provider API keys at rest with AES-256-GCM. The 32-byte key is
 * derived (HKDF-SHA256) from `LLM_SETTINGS_SECRET`, falling back to the
 * existing `SESSION_SECRET`, so no new mandatory secret is introduced.
 *
 * Ciphertext format: `v1:<b64url iv>:<b64url tag>:<b64url ciphertext>`.
 */
@Injectable()
export class LlmKeyCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret =
      (config.get<string>('LLM_SETTINGS_SECRET') ?? '').trim() ||
      (config.get<string>('SESSION_SECRET') ?? '').trim();
    if (secret === '') {
      throw new Error(
        'LLM_SETTINGS_SECRET (or SESSION_SECRET) must be set to store LLM keys',
      );
    }
    this.key = Buffer.from(
      hkdfSync('sha256', secret, KEY_SALT, KEY_INFO, KEY_BYTES),
    );
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(CIPHER, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  /** Throws when the payload is malformed or was tampered with. */
  decrypt(payload: string): string {
    const parts = payload.split(':');
    const [version, ivPart, tagPart, ciphertextPart] = parts;
    if (
      parts.length !== 4 ||
      version !== VERSION ||
      ivPart === undefined ||
      tagPart === undefined ||
      ciphertextPart === undefined
    ) {
      throw new Error('Unsupported LLM key ciphertext');
    }
    const decipher = createDecipheriv(
      CIPHER,
      this.key,
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
