import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('produces a verifiable argon2id hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'Correct horse battery staple')).toBe(false);
  });

  it('salts, so the same password hashes differently each time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('returns false for a null hash rather than treating it as a match', async () => {
    // An OAuth-created account has no password. "No password can match" is the
    // only safe reading; "any password matches" is an authentication bypass.
    expect(await verifyPassword(null, 'anything')).toBe(false);
  });

  it('returns false for a malformed hash rather than throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});
