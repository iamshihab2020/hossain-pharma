import { index, pgEnum, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { users } from './users.js';

/** PRD 5.3. Mirrors ORG_ROLE_CAPABILITIES in @nexmarket/shared; keep them in step. */
export const orgRole = pgEnum('org_role', ['OWNER', 'MANAGER', 'STAFF', 'FINANCE']);

/**
 * TENANT-OWNED (PRD 6.2). Migration 0004 puts ENABLE + FORCE + policies on it.
 *
 * This is the join table that makes PRD 5.1 work: one human can own one org,
 * work as staff in another, and shop as a buyer, all at once. The legacy system
 * could not express that because the role lived on the user.
 *
 * tenant_id is the organisation. It is named tenant_id rather than
 * organisation_id so every tenant-owned table in the codebase carries the same
 * column name and the RLS policy is copy-pasteable without renaming.
 */
export const orgMembers = pgTable(
  'org_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRole('role').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('org_members_tenant_user_role_key').on(t.tenantId, t.userId, t.role),
    index('org_members_user_idx').on(t.userId),
    index('org_members_tenant_idx').on(t.tenantId),
  ],
);
