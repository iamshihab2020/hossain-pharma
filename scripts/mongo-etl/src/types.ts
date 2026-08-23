/**
 * Typed shapes of the eight legacy MongoDB collections, confirmed by reading
 * `archive/old-code/server-side/index.js`.
 *
 * These are intermediate types for the extract stage. Nothing here is a target
 * schema; the relational target lives in @nexmarket/db.
 */
export const MONGO_COLLECTIONS = [
  'user',
  'products',
  'category',
  'cart',
  'ads',
  'approvedAds',
  'payments',
  'invoice',
] as const;

export type MongoCollection = (typeof MONGO_COLLECTIONS)[number];

export type LegacyUser = {
  _id: string;
  email: string;
  name?: string;
  /** Replaced by org_members in the target. Absent means buyer-only. */
  role?: string;
  photoURL?: string;
};

export type LegacyProduct = {
  _id: string;
  itemName: string;
  /** The seller, identified by email. Becomes an organisation plus a listing. */
  email: string;
  category?: string;
  /** A float. Becomes integer minor units. */
  price?: number;
  quantity?: number;
  description?: string;
  image?: string;
};

export type LegacyCartItem = {
  /** May be `temp-<timestamp>` rather than an ObjectId. See section 12.1 hazard 1. */
  _id: string;
  email: string;
  productId?: string;
  quantity?: number;
};

export type LegacyPayment = {
  _id: string;
  email: string;
  price?: number;
  transactionId?: string;
  date?: string;
  /** May reference carts that no longer exist. Logged, not fatal. */
  cartIds?: string[];
  status?: string;
};

export type ExtractReport = {
  collection: MongoCollection;
  documentCount: number;
};

export type QuarantinedRow = {
  collection: MongoCollection;
  id: string;
  reason: string;
};
