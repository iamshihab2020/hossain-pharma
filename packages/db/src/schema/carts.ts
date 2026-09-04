import {
  boolean,
  char,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { countries } from './reference.js';
import { listings } from './listings.js';
import { users } from './users.js';

/**
 * PLATFORM-OWNED, user-scoped in the service. All three tables here.
 *
 * A cart spans sellers by definition (PRD 9.1: "One cart, many sellers"), so
 * there is no tenant it could belong to, and buyers are not tenants (PRD 6.2).
 * The `user_id` filter is therefore the ONLY boundary on these tables, exactly
 * as it is on `saved_searches` - which means it appears in every method rather
 * than in a helper somebody could forget, and there is a test that one user
 * cannot read another's cart or address.
 */

export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label'),
    recipientName: text('recipient_name').notNull(),
    phone: text('phone').notNull(),
    line1: text('line1').notNull(),
    line2: text('line2'),
    city: text('city').notNull(),
    district: text('district').notNull(),
    /** Phase 6 resolves this to a zone for serviceability and rates. */
    postcode: text('postcode').notNull(),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    isDefaultShipping: boolean('is_default_shipping').notNull().default(false),
    isDefaultBilling: boolean('is_default_billing').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('addresses_user_idx').on(t.userId)],
);

/** MERGED and CONVERTED are both terminal; a cart is never reopened. */
export const cartStatus = pgEnum('cart_status', ['ACTIVE', 'MERGED', 'CONVERTED']);

export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null for a guest cart, set for a member cart. Never both null. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /**
     * SHA-256 of the guest's cart token, never the token itself - the same
     * treatment `sessions` gives refresh tokens (ADR 0012), for the same
     * reason: a database dump must not be a set of live credentials.
     */
    tokenHash: text('token_hash'),
    status: cartStatus('status').notNull().default('ACTIVE'),
    currency: char('currency', { length: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('carts_owner_present', sql`${t.userId} IS NOT NULL OR ${t.tokenHash} IS NOT NULL`),
    unique('carts_token_hash_key').on(t.tokenHash),
    index('carts_user_idx').on(t.userId),
  ],
);

/**
 * NO PRICE COLUMNS, deliberately, and there is a test asserting the table has
 * none.
 *
 * PRD 9.1: "Server-authoritative pricing - client never sends a price". A cart
 * line that stored a price would be a price the client could influence and the
 * server could later trust; resolving the price from `listings` at quote time
 * is what makes tampering unrepresentable rather than merely rejected.
 */
export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('cart_items_quantity_positive', sql`${t.quantity} > 0`),
    unique('cart_items_cart_listing_key').on(t.cartId, t.listingId),
    index('cart_items_cart_idx').on(t.cartId),
  ],
);
