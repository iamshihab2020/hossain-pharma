import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { users } from './users.js';

/** PRD 9.2 onboarding step 4. Mock KYC - see plan D-D, no real verification. */
export const documentType = pgEnum('document_type', ['TRADE_LICENCE', 'NATIONAL_ID', 'BANK_PROOF']);

export const documentStatus = pgEnum('document_status', ['PENDING', 'APPROVED', 'REJECTED']);

/**
 * TENANT-OWNED. Migration 0004 puts ENABLE + FORCE + policies on it.
 *
 * storageKey is an opaque handle owned by the FileStorage port, not a URL and
 * not a filesystem path. Phase 1 ships a local-filesystem adapter; PRD 13 wants
 * signed URLs, which arrives with object storage in a later phase. Nothing
 * outside the port may interpret this string.
 */
export const sellerDocuments = pgTable(
  'seller_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    type: documentType('type').notNull(),
    status: documentStatus('status').notNull().default('PENDING'),
    storageKey: text('storage_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    rejectionReason: text('rejection_reason'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('seller_documents_tenant_idx').on(t.tenantId)],
);
