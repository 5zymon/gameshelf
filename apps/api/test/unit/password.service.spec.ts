import { PasswordService } from '../../src/auth/password.service';

describe('PasswordService (unit)', () => {
  const service = new PasswordService();

  it('hashes with Argon2id, not raw and not reversible', async () => {
    const hash = await service.hash('hunter2');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toBe('hunter2');
  });

  it('salts each hash (two hashes of the same password differ)', async () => {
    const a = await service.hash('hunter2');
    const b = await service.hash('hunter2');

    expect(a).not.toBe(b);
  });

  it('verifies the correct password and rejects others', async () => {
    const hash = await service.hash('hunter2');

    await expect(service.verify(hash, 'hunter2')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong')).resolves.toBe(false);
  });

  it('treats a malformed hash as a failed verification', async () => {
    await expect(service.verify('not-a-hash', 'x')).resolves.toBe(false);
  });
});
