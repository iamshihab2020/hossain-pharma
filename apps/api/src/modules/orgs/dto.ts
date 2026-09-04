import { z } from 'zod';

/**
 * Roles are validated against the same four values the database enum and the
 * capability matrix use. A fifth value invented by a caller must be a 400 here
 * rather than a constraint violation surfacing as a 500 three layers down.
 */
export const inviteMemberSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  role: z.enum(['OWNER', 'MANAGER', 'STAFF', 'FINANCE']),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/**
 * The slug appears in public seller URLs, so it is constrained here rather than
 * left to a unique index to reject after the fact: lower-case, digits and single
 * hyphens, never leading or trailing.
 */
const slug = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lower-case words separated by single hyphens');

export const createOrgSchema = z.object({
  slug,
  legalName: z.string().min(2).max(200).trim(),
  displayName: z.string().min(2).max(120).trim(),
  // ISO 3166-1 alpha-2 and ISO 4217. Both are foreign keys into the reference
  // tables, so an unknown value is a 400 here and a constraint violation there.
  countryCode: z.string().length(2).toUpperCase(),
  defaultCurrency: z.string().length(3).toUpperCase(),
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const updateOrgSchema = z
  .object({
    legalName: z.string().min(2).max(200).trim(),
    displayName: z.string().min(2).max(120).trim(),
    countryCode: z.string().length(2).toUpperCase(),
    defaultCurrency: z.string().length(3).toUpperCase(),
  })
  .partial()
  // An empty PATCH is a caller bug, not a no-op to absorb quietly. The slug is
  // deliberately absent: it is in public URLs, so changing it is a redirect
  // problem rather than a field edit.
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

/**
 * Plan D-D: mock KYC. The bytes arrive base64-encoded in JSON rather than as
 * multipart.
 *
 * That is a deliberate Phase 1 boundary, not an oversight. What this phase has
 * to get right is the FileStorage port and the fact that a document is
 * tenant-owned and RLS-scoped; the transport is an adapter concern that changes
 * without touching either. The costs are stated: ~33% encoding overhead, and
 * the whole body is buffered. MAX_DOCUMENT_BYTES is set against that.
 */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export const uploadDocumentSchema = z.object({
  type: z.enum(['TRADE_LICENCE', 'NATIONAL_ID', 'BANK_PROOF']),
  filename: z.string().min(1).max(255),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  contentBase64: z.string().min(1),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
