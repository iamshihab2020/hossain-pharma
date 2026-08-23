import { boolean, char, integer, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Shared-reference class (PRD 6.2): no tenant_id, world-readable, no RLS.
 * These tables are the same for every tenant and every buyer.
 */
export const countries = pgTable('countries', {
  code: char('code', { length: 2 }).primaryKey(),
  name: text('name').notNull(),
  dialCode: text('dial_code').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const currencies = pgTable('currencies', {
  code: char('code', { length: 3 }).primaryKey(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  /**
   * Digits after the decimal point. Money is STORED in minor units as an
   * integer (PRD 8.4), so this is display metadata only. Nothing in the
   * pricing or ledger path divides by it.
   */
  minorUnits: integer('minor_units').notNull().default(2),
  isActive: boolean('is_active').notNull().default(true),
});
