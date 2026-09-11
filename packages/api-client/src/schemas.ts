import { z } from 'zod';

/**
 * The wire contract between the API and anything that consumes it.
 *
 * **Why zod schemas rather than a generated OpenAPI client.** The plan in
 * `docs/DESIGN-DIRECTION.md` called for generating this from OpenAPI. That was
 * checked and abandoned for a stated reason: the Nest Swagger CLI plugin infers
 * schemas from DECORATED CLASSES, and this codebase's inputs are zod schemas
 * while its outputs are plain TypeScript type aliases. The plugin has nothing
 * to read, so the emitted document types every response as an untyped object -
 * a generated client from it would be `unknown` everywhere while looking
 * authoritative, which is worse than no client at all.
 *
 * What this gives instead, and it is strictly more than types:
 *
 *   - The web app PARSES responses through these schemas, so a shape change is
 *     a loud error at the boundary rather than an `undefined` three components
 *     deep.
 *   - The API's e2e suite asserts real responses parse against the SAME
 *     schemas, so drift fails in CI on the side that caused it.
 *
 * A hand-mirrored type file can only ever be wrong in silence. This cannot:
 * both directions are checked by something that runs.
 *
 * **Dates are strings here.** The services return `Date`; JSON does not have
 * one. Modelling the post-serialisation shape is the whole point - a shared
 * type that says `Date` is a type that lies to every consumer.
 *
 * OpenAPI can still be layered on later by deriving the document from these
 * schemas. That is additive and does not change anything below.
 */

export const moneySchema = z.object({
  /** Integer MINOR units. Never a float, never a formatted string. */
  amount: z.number().int(),
  currency: z.string().length(3),
});
export type Money = z.infer<typeof moneySchema>;

/** Every collection endpoint answers this shape. PRD 13 makes cursors mandatory. */
export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

/** Endpoints that return a whole set with no paging still wrap it, so a caller
 *  never has to remember which ones are bare arrays. */
export function listOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item) });
}

// ---- catalogue --------------------------------------------------------------

export type CategoryNode = {
  id: string;
  slug: string;
  name: string;
  path: string;
  isPerishable: boolean;
  isRestricted: boolean;
  children: CategoryNode[];
};

/** Recursive, so the type is declared above and `z.lazy` closes the loop. */
export const categoryNodeSchema: z.ZodType<CategoryNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    path: z.string(),
    isPerishable: z.boolean(),
    isRestricted: z.boolean(),
    children: z.array(categoryNodeSchema),
  }),
);

export const categoriesResponse = listOf(categoryNodeSchema);

export const productSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  fromPrice: moneySchema.nullable(),
  sellerCount: z.number().int(),
});
export type ProductSummary = z.infer<typeof productSummarySchema>;

export const categoryProductsResponse = listOf(productSummarySchema);

/**
 * A BAND, never a count. Publishing an exact figure tells a competitor how fast
 * a rival is selling, and nothing on the buyer's side needs more than the band.
 */
export const offerAvailabilitySchema = z.enum(['IN_STOCK', 'LOW_STOCK']);
export type OfferAvailability = z.infer<typeof offerAvailabilitySchema>;

export const publicOfferSchema = z.object({
  listingId: z.string(),
  seller: z.object({ id: z.string(), slug: z.string(), displayName: z.string() }),
  price: moneySchema,
  shipping: moneySchema,
  landedPrice: moneySchema,
  dispatchDays: z.number().int(),
  availability: offerAvailabilitySchema,
  isWinner: z.boolean(),
});
export type PublicOffer = z.infer<typeof publicOfferSchema>;

export const publicBuyBoxSchema = z.object({
  /**
   * Which basis the ranking used. Today always `flat-shipping`: delivery zones
   * are Phase 6, so this is each seller's flat rate rather than a quote to the
   * buyer's address. It travels so a client can SAY so instead of presenting an
   * estimate as a quote.
   */
  basis: z.literal('flat-shipping'),
  otherSellerCount: z.number().int(),
  winner: publicOfferSchema.nullable(),
  offers: z.array(publicOfferSchema),
});
export type PublicBuyBox = z.infer<typeof publicBuyBoxSchema>;

export const productVariantSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  /**
   * CHARGEABLE grams - `max(actual, volumetric)` - or null when unmeasured.
   *
   * The server does the courier arithmetic and sends one number; the page's
   * delivery check passes it straight back as `weightGrams`. Shipping the raw
   * weight and three dimensions would give the client three chances to combine
   * them differently from the server.
   */
  chargeableGrams: z.number().int().nullable(),
  buyBox: publicBuyBoxSchema,
});
export type ProductVariant = z.infer<typeof productVariantSchema>;

export const productPageSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  description: z.string().nullable(),
  category: z.object({
    slug: z.string(),
    name: z.string(),
    path: z.string(),
    isRestricted: z.boolean(),
  }),
  attributes: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
  ),
  media: z.array(
    z.object({ id: z.string(), altText: z.string().nullable(), position: z.number().int() }),
  ),
  variants: z.array(productVariantSchema),
});
export type ProductPage = z.infer<typeof productPageSchema>;

// ---- search -----------------------------------------------------------------

export const searchHitSchema = z.object({
  productId: z.string(),
  slug: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  categorySlug: z.string(),
  price: moneySchema.nullable(),
  sellerCount: z.number().int(),
  inStock: z.boolean(),
  createdAt: z.string(),
});
export type SearchHit = z.infer<typeof searchHitSchema>;

export const facetValueSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number().int(),
});
export type FacetValue = z.infer<typeof facetValueSchema>;

export const facetsSchema = z.object({
  category: z.array(facetValueSchema),
  brand: z.array(facetValueSchema),
  availability: z.array(facetValueSchema),
  price: z.array(facetValueSchema),
  attributes: z.array(
    z.object({ key: z.string(), label: z.string(), values: z.array(facetValueSchema) }),
  ),
});
export type Facets = z.infer<typeof facetsSchema>;

export const searchResultSchema = z.object({
  items: z.array(searchHitSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
  facets: facetsSchema,
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const suggestResponse = listOf(z.object({ slug: z.string(), name: z.string() }));
export const similarResponse = listOf(searchHitSchema);

export const SORT_KEYS = ['relevance', 'price_asc', 'price_desc', 'newest', 'sellers'] as const;
export const sortKeySchema = z.enum(SORT_KEYS);
export type SortKey = z.infer<typeof sortKeySchema>;

// ---- cart -------------------------------------------------------------------

export const cartLineSchema = z.object({
  id: z.string(),
  listingId: z.string(),
  productName: z.string(),
  variantSku: z.string(),
  quantity: z.number().int(),
  unitPrice: moneySchema,
  lineTotal: moneySchema,
  /** An unavailable line is SHOWN, not dropped: silently removing it is how a
   *  buyer finds out at the payment screen that their basket changed. */
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const cartSellerGroupSchema = z.object({
  sellerId: z.string(),
  sellerSlug: z.string(),
  sellerName: z.string(),
  lines: z.array(cartLineSchema),
  subtotal: moneySchema,
});
export type CartSellerGroup = z.infer<typeof cartSellerGroupSchema>;

export const cartViewSchema = z.object({
  id: z.string(),
  currency: z.string().length(3),
  groups: z.array(cartSellerGroupSchema),
  subtotal: moneySchema,
  itemCount: z.number().int(),
  hasUnavailableLines: z.boolean(),
});
export type CartView = z.infer<typeof cartViewSchema>;

// ---- addresses --------------------------------------------------------------

export const addressSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  recipientName: z.string(),
  phone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  district: z.string(),
  /** Four digits. Bangladesh postcodes are exactly four, and the API enforces it. */
  postcode: z.string(),
  countryCode: z.string().length(2),
  isDefaultShipping: z.boolean(),
  isDefaultBilling: z.boolean(),
  createdAt: z.string(),
});
export type Address = z.infer<typeof addressSchema>;

export const addressesResponse = listOf(addressSchema);

/** The request body, mirrored from the API's own zod schema so the form and the
 *  server agree on what "valid" means before a round trip. */
export const createAddressSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  recipientName: z.string().trim().min(1).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{6,20}$/, 'Phone must be 6-20 digits, optionally with + - or spaces'),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(80),
  district: z.string().trim().min(1).max(80),
  postcode: z.string().trim().regex(/^[0-9]{4}$/, 'Postcode must be four digits'),
  countryCode: z.string().trim().length(2).toUpperCase(),
  isDefaultShipping: z.boolean().optional(),
  isDefaultBilling: z.boolean().optional(),
});
export type CreateAddressInput = z.infer<typeof createAddressSchema>;

// ---- quote and checkout -----------------------------------------------------

export const quoteLineSchema = z.object({
  listingId: z.string(),
  productName: z.string(),
  variantSku: z.string(),
  quantity: z.number().int(),
  unitPrice: moneySchema,
  lineTotal: moneySchema,
  commissionBps: z.number().int(),
  commission: moneySchema,
});
export type QuoteLine = z.infer<typeof quoteLineSchema>;

export const quoteGroupSchema = z.object({
  sellerId: z.string(),
  sellerSlug: z.string(),
  sellerName: z.string(),
  lines: z.array(quoteLineSchema),
  subtotal: moneySchema,
  shipping: moneySchema,
  tax: moneySchema,
  commission: moneySchema,
  total: moneySchema,
});
export type QuoteGroup = z.infer<typeof quoteGroupSchema>;

/**
 * The delivery zone the address resolved to, or null when nothing serves it.
 *
 * On the QUOTE rather than per group: it is a fact about where the buyer is,
 * not about who is selling. `codAllowed` is what withdraws cash on delivery -
 * PRD 9.1's "COD where the zone allows it" - and the API enforces the same rule
 * on confirm, so hiding the radio is a courtesy rather than the control.
 */
export const quoteZoneSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  areaName: z.string(),
  codAllowed: z.boolean(),
  transitDaysMin: z.number().int(),
  transitDaysMax: z.number().int(),
});
export type QuoteZone = z.infer<typeof quoteZoneSchema>;

export const quoteSchema = z.object({
  cartId: z.string(),
  currency: z.string().length(3),
  groups: z.array(quoteGroupSchema),
  subtotal: moneySchema,
  shipping: moneySchema,
  tax: moneySchema,
  total: moneySchema,
  /** True if any line sits in a RESTRICTED category. */
  requiresAgeCheck: z.boolean(),
  zone: quoteZoneSchema.nullable(),
});
export type Quote = z.infer<typeof quoteSchema>;

/**
 * `GET /serviceability`.
 *
 * NOT-SERVICEABLE IS A 200 with `serviceable: false`, so the optional fields
 * below are absent rather than null in that case. A 404 would say the endpoint
 * found nothing, when what was found is that no courier goes there.
 */
export const serviceabilitySchema = z.object({
  serviceable: z.boolean(),
  postcode: z.string(),
  countryCode: z.string(),
  areaName: z.string().optional(),
  zoneName: z.string().optional(),
  codAllowed: z.boolean().optional(),
  /** Dispatch plus transit, as a RANGE. An estimate shown as one number reads
   *  as a promise. */
  earliestDays: z.number().int().optional(),
  latestDays: z.number().int().optional(),
  shipping: moneySchema.nullable().optional(),
  /** A weight was given and no band covers it: freight, not standard delivery. */
  overWeightLimit: z.boolean().optional(),
});
export type Serviceability = z.infer<typeof serviceabilitySchema>;

/**
 * One delivery window. Minutes from midnight in the ZONE's own reckoning - a
 * timestamptz would invite a conversion that turns "Saturday morning" into
 * Friday night for a reader elsewhere.
 */
export const deliverySlotSchema = z.object({
  id: z.string(),
  date: z.string(),
  startMinute: z.number().int(),
  endMinute: z.number().int(),
  /** What is LEFT, never how many others booked. Full windows are omitted. */
  remaining: z.number().int(),
});
export type DeliverySlot = z.infer<typeof deliverySlotSchema>;

export const deliverySlotsResponse = z.object({
  serviceable: z.boolean(),
  /** Empty is legitimate: no international zone has scheduled windows. */
  slots: z.array(deliverySlotSchema),
});

export const warehouseSchema = z.object({
  id: z.string(),
  name: z.string(),
  addressLine: z.string(),
  city: z.string(),
  district: z.string(),
  postcode: z.string(),
  countryCode: z.string(),
  contactPhone: z.string(),
  isDefault: z.boolean(),
  isPickupPoint: z.boolean(),
  priority: z.number().int(),
  listingCount: z.number().int(),
  unitsOnHand: z.number().int(),
});
export type Warehouse = z.infer<typeof warehouseSchema>;
export const warehousesResponse = z.object({ items: z.array(warehouseSchema) });

const codRowSchema = z.object({
  orderId: z.string(),
  orderNumber: z.string(),
  status: z.string(),
  expected: moneySchema,
  collected: moneySchema.nullable(),
  deliveredAt: z.string().nullable(),
});
export type CodRow = z.infer<typeof codRowSchema>;

export const codReconciliationSchema = z.object({
  currency: z.string(),
  expected: moneySchema,
  collected: moneySchema,
  outstanding: moneySchema,
  rows: z.array(codRowSchema),
});
export type CodReconciliation = z.infer<typeof codReconciliationSchema>;

export const codRowsResponse = z.object({ items: z.array(codRowSchema) });

export const codCollectionSchema = z.object({
  orderId: z.string(),
  orderNumber: z.string(),
  expected: moneySchema,
  collected: moneySchema,
  outstanding: moneySchema,
  collectedAt: z.string(),
});
export type CodCollection = z.infer<typeof codCollectionSchema>;

export const returnPickupSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  orderNumber: z.string(),
  status: z.enum(['SCHEDULED', 'COLLECTED', 'CANCELLED']),
  slot: z.object({
    id: z.string(),
    date: z.string(),
    startMinute: z.number().int(),
    endMinute: z.number().int(),
  }),
  createdAt: z.string(),
});
export type ReturnPickup = z.infer<typeof returnPickupSchema>;
export const returnPickupsResponse = z.object({ items: z.array(returnPickupSchema) });

const dispatchPickSchema = z.object({
  orderItemId: z.string(),
  quantity: z.number().int(),
});

export const dispatchPlanSchema = z.object({
  /** True when the order needs more than one parcel. */
  splits: z.boolean(),
  allocations: z.array(
    z.object({
      warehouseId: z.string(),
      warehouseName: z.string(),
      picks: z.array(dispatchPickSchema),
    }),
  ),
  /** Units no warehouse can fill. A short plan is still worth dispatching. */
  unfulfilled: z.array(dispatchPickSchema),
});
export type DispatchPlan = z.infer<typeof dispatchPlanSchema>;


export const PAYMENT_METHODS = ['mock', 'cod'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const placedOrderSchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
  sellerId: z.string(),
  sellerName: z.string(),
  total: moneySchema,
});
export type PlacedOrder = z.infer<typeof placedOrderSchema>;

export const confirmationSchema = z.object({
  paymentIntentId: z.string(),
  /**
   * Whatever the intent was CREATED at. Checkout never advances it - the
   * webhook is the only writer of payment status - so a confirmation that said
   * SUCCEEDED would be the API claiming money it has not seen.
   */
  status: z.string(),
  method: paymentMethodSchema,
  clientSecret: z.string().nullable(),
  orders: z.array(placedOrderSchema),
  total: moneySchema,
});
export type Confirmation = z.infer<typeof confirmationSchema>;

// ---- orders -----------------------------------------------------------------

/**
 * The eight states an order can hold, and the five Phase 5 added.
 *
 * Deliberately not PRD 9.2's list: PACKED moves no money and no stock,
 * OUT_FOR_DELIVERY is a Phase 6 carrier event, and PARTIALLY_SHIPPED - which the
 * acceptance criterion needs - has nowhere to live in a linear list.
 */
export const orderStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'PAID',
  'ACCEPTED',
  'REJECTED',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  /** Phase 6. A courier reports it; nobody sets it by hand. */
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderItemViewSchema = z.object({
  id: z.string(),
  listingId: z.string(),
  productName: z.string(),
  variantSku: z.string(),
  quantity: z.number().int(),
  unitPrice: moneySchema,
  lineTotal: moneySchema,
});
export type OrderItemView = z.infer<typeof orderItemViewSchema>;

/**
 * One order belongs to ONE seller. A cart spanning three sellers becomes three
 * of these under a single payment, which is why a buyer's history is a list of
 * orders rather than a list of shipments.
 */
export const orderViewSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  orderNumber: z.string(),
  status: orderStatusSchema,
  sellerId: z.string(),
  sellerName: z.string(),
  subtotal: moneySchema,
  shipping: moneySchema,
  tax: moneySchema,
  total: moneySchema,
  placedAt: z.string(),
  items: z.array(orderItemViewSchema),
});
export type OrderView = z.infer<typeof orderViewSchema>;

export const ordersResponse = pageOf(orderViewSchema);

// ---- fulfilment -------------------------------------------------------------

/**
 * Phase 6 added the two middle states with the carrier feed that reports them.
 * A seller can observe dispatch and arrival; only a courier knows the rest.
 */
export const shipmentStatusSchema = z.enum([
  'DISPATCHED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]);
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>;

export const shipmentItemSchema = z.object({
  orderItemId: z.string(),
  quantity: z.number().int().positive(),
});
export type ShipmentItem = z.infer<typeof shipmentItemSchema>;

/**
 * A parcel. Carrier and tracking number are nullable because a seller may hand
 * a box to a rider with neither - Phase 6's `ShippingProvider` fills them in
 * when the seller books one, and leaves them null when they do not.
 */
export const shipmentViewSchema = z.object({
  id: z.string(),
  shipmentNumber: z.string(),
  status: shipmentStatusSchema,
  carrierName: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  dispatchedAt: z.string(),
  deliveredAt: z.string().nullable(),
  items: z.array(shipmentItemSchema),
});
export type ShipmentView = z.infer<typeof shipmentViewSchema>;

/**
 * What one auto-dispatch produced. Declared HERE, after `shipmentViewSchema`,
 * because it embeds it - zod schemas are values, so a forward reference is a
 * temporal-dead-zone error rather than a type error, and it fails at import
 * time with a message that does not mention this file.
 */
export const autoDispatchSchema = z.object({
  shipments: z.array(shipmentViewSchema),
  splits: z.boolean(),
  warehouses: z.array(z.object({ id: z.string(), name: z.string() })),
  unfulfilled: z.array(z.object({ orderItemId: z.string(), quantity: z.number().int() })),
});
export type AutoDispatch = z.infer<typeof autoDispatchSchema>;

export const orderEventTypeSchema = z.enum([
  'PLACED',
  'PAID',
  'ACCEPTED',
  'REJECTED',
  'SHIPMENT_DISPATCHED',
  // Phase 6 carrier events. Always actor SYSTEM - reported, not decided.
  'SHIPMENT_IN_TRANSIT',
  'SHIPMENT_OUT_FOR_DELIVERY',
  'SHIPMENT_DELIVERED',
  'COD_COLLECTED',
  'RETURN_PICKUP_SCHEDULED',
  'LINES_CANCELLED',
  'CANCELLED',
]);
export type OrderEventType = z.infer<typeof orderEventTypeSchema>;

/**
 * One entry on the buyer's timeline.
 *
 * `payload` is deliberately loose: it carries whatever the type needs - a
 * carrier, a tracking number, a rejection reason, the cancelled quantities - and
 * pinning a shape per type here would mean editing this file every time an
 * event learns a new field.
 */
export const orderEventSchema = z.object({
  id: z.string(),
  type: orderEventTypeSchema,
  actor: z.enum(['BUYER', 'SELLER', 'SYSTEM']),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type OrderEvent = z.infer<typeof orderEventSchema>;

/**
 * The DETAIL view. The list does not carry parcels or history, on purpose: an
 * order history page renders twenty rows and displays neither.
 */
export const orderDetailSchema = orderViewSchema.extend({
  /**
   * The address as it was on the day, snapshotted onto the order. Loose on
   * purpose: it is a jsonb column, and a packing slip is not the place to throw
   * because a field the schema did not expect turned up years later.
   */
  /**
   * The address as it was ON THE DAY, snapshotted onto the order.
   *
   * Typed rather than left as an open record, because readers need fields from
   * it - the return-pickup panel resolves collection windows from `postcode`
   * and `countryCode`, and a packing slip prints the rest. `passthrough` keeps
   * any extra fields the API snapshots without this file having to track them,
   * so adding one server-side is not a breaking change here.
   */
  shippingAddress: z
    .object({
      recipientName: z.string().optional(),
      phone: z.string().optional(),
      line1: z.string().optional(),
      line2: z.string().nullable().optional(),
      city: z.string().optional(),
      district: z.string().optional(),
      postcode: z.string().default(''),
      countryCode: z.string().default('BD'),
    })
    .loose(),
  shipments: z.array(shipmentViewSchema),
  timeline: z.array(orderEventSchema),

  /**
   * How the buyer is paying. DETAIL ONLY - the list shows twenty orders and
   * has no question that needs it.
   *
   * On the view because status alone cannot answer "may the seller accept
   * this?". A cash order waits at PENDING_PAYMENT until the courier comes
   * back, and shipping before the money arrives is what cash on delivery
   * means; a CARD order at PENDING_PAYMENT is one nobody paid for. Same
   * status, opposite answers.
   */
  paymentMethod: paymentMethodSchema,
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

// ---- organisations ----------------------------------------------------------

/**
 * An organisation the signed-in person belongs to.
 *
 * `roles` is a LIST because one human can hold several roles in one org, and
 * the effective permission is the union - never the first match.
 */
export const myOrgSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  status: z.string(),
  roles: z.array(z.string()),
});
export type MyOrg = z.infer<typeof myOrgSchema>;

export const myOrgsResponse = z.object({ items: z.array(myOrgSchema) });

// ---- auth -------------------------------------------------------------------

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  platformRole: z.enum(['BUYER', 'ADMIN']),
});
export type AuthUser = z.infer<typeof authUserSchema>;

/** The refresh token is a cookie and NEVER appears in a body. */
export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: authUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

// ---- reviews (Phase 7) ------------------------------------------------------

export const reviewStatusSchema = z.enum(['PUBLISHED', 'FLAGGED', 'REMOVED']);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/**
 * One review as a page renders it.
 *
 * `authorName` and `sellerName`, never ids: a review is read by strangers, and
 * the two things they need to judge it are who wrote it and who sold it. No
 * `authorUserId` - a public list that carries a user id hands out a way to
 * correlate one person's purchases across the whole catalogue, and the page has
 * no use for it.
 */
export const reviewSchema = z.object({
  id: z.string(),
  productId: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string(),
  body: z.string(),
  authorName: z.string(),
  sellerName: z.string(),
  status: reviewStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Review = z.infer<typeof reviewSchema>;
export const reviewsResponse = z.object({ items: z.array(reviewSchema) });

/**
 * The rating summary: an average, a total, and the five bars.
 *
 * `average` is NULLABLE and that is load-bearing all the way to the UI - an
 * unrated product shows "No reviews yet", not "0.0 stars", and the two are
 * different claims about a seller nobody has bought from yet.
 */
export const ratingSummarySchema = z.object({
  average: z.number().nullable(),
  total: z.number().int(),
  distribution: z.array(
    z.object({
      stars: z.number().int().min(1).max(5),
      count: z.number().int(),
      share: z.number().int(),
    }),
  ),
});
export type RatingSummary = z.infer<typeof ratingSummarySchema>;

/** A delivered line the signed-in buyer has not reviewed yet. */
export const reviewablePurchaseSchema = z.object({
  orderItemId: z.string(),
  orderNumber: z.string(),
  productId: z.string(),
  productName: z.string(),
  variantSku: z.string(),
  sellerName: z.string(),
  deliveredAt: z.string(),
});
export type ReviewablePurchase = z.infer<typeof reviewablePurchaseSchema>;
export const reviewablePurchasesResponse = z.object({
  items: z.array(reviewablePurchaseSchema),
});

export const reportOutcomeSchema = z.object({ flagged: z.boolean() });
export type ReportOutcome = z.infer<typeof reportOutcomeSchema>;

// ---- error bodies -----------------------------------------------------------

/**
 * Nest's exception body, plus the `code` the checkout path adds.
 *
 * `code` is what makes a 409 actionable: `PRICE_CHANGED` carries the old and
 * new totals so the page can show the difference, and `AGE_CHECK_REQUIRED`
 * means "ask for a date of birth", not "something went wrong".
 */
export const apiErrorSchema = z.object({
  statusCode: z.number().int().optional(),
  message: z.union([z.string(), z.array(z.string())]).optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  expected: moneySchema.optional(),
  actual: moneySchema.optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
