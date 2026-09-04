import { z } from 'zod';

/**
 * Zod, not class-validator. The codebase already depends on zod 4 for the
 * environment contract, and carrying two validation stories means two places
 * to look when a payload is rejected.
 *
 * Email is lower-cased HERE rather than in the service, so every consumer of a
 * parsed DTO gets the canonical form and no lookup can miss a row because the
 * caller typed a capital letter.
 */
export const registerSchema = z.object({
  email: z.string().email().max(320).toLowerCase(),
  /**
   * 12 characters, no composition rules. NIST 800-63B: length beats character
   * classes, and forced symbols push people towards Password1! - which is
   * weaker than four ordinary words.
   */
  password: z.string().min(12).max(256),
  displayName: z.string().min(1).max(120),
});

export const loginSchema = z.object({
  email: z.string().email().max(320).toLowerCase(),
  password: z.string().min(1).max(256),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
