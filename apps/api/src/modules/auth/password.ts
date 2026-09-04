import { hash, verify, type Algorithm } from '@node-rs/argon2';

/**
 * @node-rs/argon2 declares Algorithm as an ambient `const enum`, which TS2748
 * forbids under isolatedModules (this package emits isolated modules, so the
 * compiler cannot inline the member). The value exists at runtime; only the
 * type-level access is barred. 2 is Argon2id in that enum.
 *
 * The magic number is not unguarded: password.test.ts asserts the produced hash
 * begins with `$argon2id$`, so a wrong value fails the suite rather than
 * silently downgrading every password on the platform to Argon2d.
 */
const ARGON2ID = 2 as Algorithm;

/**
 * PRD 13 requires argon2id. These are the OWASP-recommended minimums as of
 * 2026-08: 19 MiB memory, 2 iterations, 1 degree of parallelism.
 *
 * Do not lower memoryCost to speed up the test suite. If the suite is slow,
 * mark the slow tests, do not weaken the hash - the parameters are the control.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/**
 * A null hash means the account has no password - it was created through OAuth
 * and has not set one. That must read as "no password can match", never as
 * "any password matches". A malformed hash is treated the same way: verify
 * throws on garbage input, and an exception on the login path must not become a
 * 500 that distinguishes a real account from a fake one.
 */
export async function verifyPassword(hashed: string | null, plain: string): Promise<boolean> {
  if (hashed === null) return false;
  try {
    return await verify(hashed, plain, OPTIONS);
  } catch {
    return false;
  }
}
